#!/usr/bin/env python3
"""在庫から飲んだ飲酒記録に、購入記録の画像をコピーして紐づける（一度きりのバックフィル）。

「在庫から飲む」で作った飲酒記録には、購入記録の銘柄・カテゴリ・紐づけ ID だけが
引き継がれ、画像は引き継がれていなかった。購入記録には写真があるのに飲酒記録の
一覧ではプレースホルダーになるため、利用者からは画像が表示されない不具合に見える。

画像はキーの文字列だけを共有させず、S3 上で実体ごと複製する。同じキーを 2 つの
記録が指すと、片方を削除したときに deleteImage が実体を消して、もう片方の画像まで
見えなくなるため。複製後はそれぞれの記録が自分の画像を持つ。

使い方:
    uv run --with boto3 python infra/scripts/backfill-stock-drinking-images.py \\
        --bucket dev-sakekasu-images \\
        --purchase-table dev-sakekasu-purchase-records \\
        --drinking-table dev-sakekasu-drinking-records --dry-run

    # 実際に書き込む
    uv run --with boto3 python infra/scripts/backfill-stock-drinking-images.py \\
        --bucket dev-sakekasu-images \\
        --purchase-table dev-sakekasu-purchase-records \\
        --drinking-table dev-sakekasu-drinking-records --apply

AWS 認証情報は AWS_PROFILE 等の通常の方法で解決される。
何度実行しても結果が変わらない（画像を持つ飲酒記録は対象外にする）。
"""

import argparse
import sys

import boto3
from botocore.exceptions import ClientError

# フロントエンド（src/features/image/lib/thumbnailKey.ts）と揃える必要がある
THUMBNAIL_PREFIX = "thumb_"


def is_thumbnail(file_name: str) -> bool:
    return file_name.startswith(THUMBNAIL_PREFIX)


def to_thumbnail_key(key: str) -> str:
    """原画キーからサムネイルキーを導出する（フロントエンドと同じ規則）。"""
    head, sep, file_name = key.rpartition("/")
    return f"{head}{sep}{THUMBNAIL_PREFIX}{file_name}"


def effective_image_keys(item: dict) -> list[str]:
    """記録が実際に表示に使う画像キーを返す。

    imageKeys(複数) があればそれを、無ければ imageKey(単数) を使う。
    フロントエンドの normalizeImageKeys と同じ規則。
    """
    keys = [v["S"] for v in item.get("imageKeys", {}).get("L", []) if v.get("S")]
    if keys:
        return keys
    single = item.get("imageKey", {}).get("S")
    return [single] if single else []


def dedupe(keys: list[str]) -> list[str]:
    """並びを保って重複を落とす。

    同じキーが 2 回入っている記録があり、そのままコピーすると
    飲酒記録側も同じ画像を 2 枚持つことになる。
    """
    seen = set()
    result = []
    for key in keys:
        if key not in seen:
            seen.add(key)
            result.append(key)
    return result


def is_valid_file_name(file_name: str) -> bool:
    """コピー先の末尾に使える名前か（Lambda の assertFileName と同じ規則）。

    記録が持つキーは利用者が指定したファイル名を含む。末尾が `..` や空の
    キーをそのまま複製先に使うと、実体の無い位置を指すキーが記録に残る。
    """
    return bool(file_name) and "/" not in file_name and file_name not in (".", "..")


def reserve_file_name(file_name: str, used: set[str]) -> str:
    """コピー先で名前がぶつからないように、使う名前を確保する。

    別々のフォルダにある同名ファイル（image.jpg など）を 1 つの記録へ
    まとめるため、2 枚目以降は拡張子の前に連番を入れる。

    サムネイルは原画名から導出する決まりで、連番を振って避けることが
    できない。そのため原画名を決める時点で、その導出先（`thumb_<名前>`）も
    一緒に押さえる。`thumb_` を含むファイル名は利用者が普通に付けられるので、
    押さえておかないと「先に入れた画像のサムネイル」と「後から入れた画像の
    原画」が同じキーになり、片方が上書きされる。

    Lambda 側の reserveFileName と同じ規則。どちらかだけ直すと、
    同じ入力で違う結果になる。
    """

    def names_to_take(name: str) -> list[str]:
        # 既にサムネイルを指す名前なら、そこからさらに導出はしない
        if name.startswith(THUMBNAIL_PREFIX):
            return [name]
        return [name, f"{THUMBNAIL_PREFIX}{name}"]

    def take(candidate: str) -> bool:
        names = names_to_take(candidate)
        if any(name in used for name in names):
            return False
        used.update(names)
        return True

    if take(file_name):
        return file_name

    stem, dot, ext = file_name.rpartition(".")
    if not dot:
        stem, ext = file_name, ""
    for i in range(2, 100):
        if take(f"{stem}-{i}{dot}{ext}"):
            return f"{stem}-{i}{dot}{ext}"
    raise RuntimeError(f"コピー先の名前を決められない: {file_name}")


def scan_all(dynamodb, table_name: str) -> list[dict]:
    """テーブルを最後まで読む（1MB ごとのページングを処理する）。"""
    items = []
    kwargs = {"TableName": table_name}
    while True:
        result = dynamodb.scan(**kwargs)
        items.extend(result["Items"])
        last = result.get("LastEvaluatedKey")
        if not last:
            return items
        kwargs["ExclusiveStartKey"] = last


def object_exists(s3, bucket: str, key: str) -> bool:
    try:
        s3.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as err:
        if err.response["Error"]["Code"] in ("404", "NoSuchKey"):
            return False
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--purchase-table", required=True)
    parser.add_argument("--drinking-table", required=True)
    parser.add_argument("--region", default="ap-northeast-1")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true", help="対象を表示するだけ")
    group.add_argument("--apply", action="store_true", help="実際に複製して紐づける")
    args = parser.parse_args()

    session = boto3.session.Session(region_name=args.region)
    s3 = session.client("s3")
    dynamodb = session.client("dynamodb")

    purchases = {it["id"]["S"]: it for it in scan_all(dynamodb, args.purchase_table)}
    drinkings = scan_all(dynamodb, args.drinking_table)

    planned = 0
    copied = 0
    skipped_existing = 0
    missing_source = 0
    skipped_invalid = 0

    for record in sorted(drinkings, key=lambda x: x.get("createdAt", {}).get("S", "")):
        record_id = record["id"]["S"]
        name = record.get("sakeName", {}).get("S", "")
        owner = record.get("owner", {}).get("S", "")

        # すでに自分の画像を持つ記録は触らない（再実行しても増えない）
        if effective_image_keys(record):
            continue

        # owner はキーの先頭に入る。空のまま組み立てると、どの利用者にも
        # 属さない位置（/drinking/...）へ書き込むことになる
        if not owner:
            print(f"[skip] {name}: owner が無い記録")
            continue

        purchase_id = record.get("purchaseRecordId", {}).get("S")
        if not purchase_id:
            continue

        purchase = purchases.get(purchase_id)
        if purchase is None:
            print(f"[skip] {name}: 紐づく購入記録 {purchase_id} が見つからない")
            continue

        # このスクリプトは全利用者のデータを読み書きできる権限で動く。
        # purchaseRecordId が他人の記録を指していた場合に、他人の画像を
        # コピーして別の利用者へ配ってしまわないよう持ち主を確かめる
        purchase_owner = purchase.get("owner", {}).get("S")
        if purchase_owner != owner:
            print(f"[skip] {name}: 購入記録の持ち主が違う")
            continue

        source_keys = dedupe(effective_image_keys(purchase))
        if not source_keys:
            print(f"[skip] {name}: 紐づく購入記録に画像が無い")
            continue

        planned += 1
        print(f"\n{name}  ({record_id})")

        used_names: set[str] = set()
        new_keys: list[str] = []

        for source in source_keys:
            # 複製できなかったキーを記録に書くと、実体の無い画像を
            # 指したまま残る。存在を確かめてから採用する
            if not object_exists(s3, args.bucket, source):
                print(f"  [!] 原画が S3 に無い: {source}")
                missing_source += 1
                continue

            source_file_name = source.rpartition("/")[2]
            if not is_valid_file_name(source_file_name):
                print(f"  [!] 使えないファイル名なので飛ばす: {source}")
                skipped_invalid += 1
                continue

            file_name = reserve_file_name(source_file_name, used_names)
            dest = f"{owner}/drinking/{record_id}/{file_name}"
            new_keys.append(dest)

            print(f"  原画 {source.split('/', 2)[2]}")
            print(f"    → {dest.split('/', 2)[2]}")

            if args.apply:
                if object_exists(s3, args.bucket, dest):
                    skipped_existing += 1
                else:
                    s3.copy_object(
                        Bucket=args.bucket,
                        Key=dest,
                        CopySource={"Bucket": args.bucket, "Key": source},
                    )
                    copied += 1

            # 元がすでにサムネイルなら、そこからさらに導出はしない。
            # thumb_thumb_... という在りもしないキーを探すだけになる
            if is_thumbnail(source_file_name):
                continue

            # サムネイルは兄弟キーとして導出する。未生成の記録もあるので、
            # 在るときだけ複製する（無ければ一覧は原画にフォールバックする）
            source_thumb = to_thumbnail_key(source)
            dest_thumb = to_thumbnail_key(dest)
            if object_exists(s3, args.bucket, source_thumb):
                print(f"  サムネイル → {dest_thumb.split('/', 2)[2]}")
                if args.apply and not object_exists(s3, args.bucket, dest_thumb):
                    s3.copy_object(
                        Bucket=args.bucket,
                        Key=dest_thumb,
                        CopySource={"Bucket": args.bucket, "Key": source_thumb},
                    )
                    copied += 1
            else:
                print("  サムネイルは元に無いので作らない（原画で表示される）")

        if not new_keys:
            print("  複製できた画像が無いので記録は更新しない")
            continue

        if args.apply:
            dynamodb.update_item(
                TableName=args.drinking_table,
                Key={"id": {"S": record_id}},
                UpdateExpression="SET imageKeys = :keys, imageKey = :first",
                ExpressionAttributeValues={
                    ":keys": {"L": [{"S": k} for k in new_keys]},
                    ":first": {"S": new_keys[0]},
                },
            )
            print(f"  記録を更新した（{len(new_keys)} 枚）")

    print()
    print(f"対象の記録: {planned} 件")
    if args.apply:
        print(f"複製したオブジェクト: {copied} 件")
        if skipped_existing:
            print(f"すでにあって飛ばした: {skipped_existing} 件")
    else:
        print("--dry-run のため何も書き込んでいない")
    if missing_source:
        print(f"元の画像が見つからなかった: {missing_source} 件")
    if skipped_invalid:
        print(f"ファイル名が使えず飛ばした: {skipped_invalid} 件")

    return 0


if __name__ == "__main__":
    sys.exit(main())
