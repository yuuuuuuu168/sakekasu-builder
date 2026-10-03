#!/usr/bin/env python3
"""記録と画像の持ち主を、旧ユーザープールの sub から共通ログインの sub へ付け替える。

ログインを共通ログイン（sakekasu-integrated_environment）へ移すと、同じ人でも
sub が変わる。このアプリは sub で持ち主を見分けているので、付け替えるまで
これまでの記録も画像も見えない。手順の全体は docs/shared-login.md にある。

sub を使っている場所は3つで、ここで全部を扱う。

1. DynamoDB の購入記録・飲酒記録の `owner` 属性
   主キーは `id` だけで、`owner` は通常の属性（GSI `owner-index` のパーティションキー）。
   キーを付け替えるのではなく、同じ項目の `owner` を書き換える。
   新しい id で写しを作る方式は採らない。飲酒記録の `purchaseRecordId` が
   購入記録の id を指しているので、id が変わると在庫との紐づけが切れる
2. 同じ項目の `imageKey` / `imageKeys`
   画像のキーは `{sub}/{種別}/{recordId}/{ファイル名}` で、先頭に sub が入る。
   AppSync のリゾルバーと presigned-url Lambda は「キーが自分の sub/ で始まるか」で
   持ち主を確かめるので、owner だけ変えると画像が開けず、追加も削除もできなくなる
3. S3 の画像バケットの `{sub}/` 以下（サムネイル `thumb_*` を含む）
   新しいキーへコピーする。旧キーの実体は消さない。`{sub}/tmp/` は記録の作成前に
   OCR 用に上げた一時領域で、1日で消えるうえどの記録からも参照されないので写さない

sub をキーにしているものは、ほかに次の2つがあるが、このスクリプトでは扱わない。

- ソムリエの AgentCore Memory（actorId が sub。好みの記憶と会話の続き）。
  共通ログインに移ると新しい利用者として一から貯め直しになる
- ブラウザの localStorage（相談の表示用の写し・絞り込み条件。キーに sub を含む）。
  端末側の表示キャッシュなので、そのまま捨てられる

Identity Pool（cognito-identity）は使っていない。identityId をキーにしたデータは無い。

## 安全のための決まり

- 既定は dry-run。件数と例を出すだけで何も書かない。書くのは `--apply` のときだけ
- 先に S3、次に DynamoDB。記録が指す先の画像が先に揃っているようにする
- S3 は新しいキーにすでにあればスキップする。旧キーは消さない
- DynamoDB は条件付きで書く。`owner` が旧 sub のままで、読んだあとに
  `updatedAt` が変わっていない項目だけを書き換える。すでに新しい sub に
  なっている項目には触れない
- だから何度流しても安全。途中で落ちても、もう一度流せば続きから進む
- 切り戻すときは `--old-sub` と `--new-sub` を入れ替えて流す。画像は旧キーに
  残っているのでコピーはすべてスキップになり、記録の owner と画像キーだけが戻る。
  さらに前の状態が要るなら、テーブルの PITR（35日）から戻せる

使い方（Mac から、管理者権限のプロファイルで）:
    uv run --with boto3 python infra/scripts/migrate_owner_sub.py \\
        --old-sub <旧 sub> --new-sub <新 sub> \\
        --purchase-table dev-sakekasu-purchase-records \\
        --drinking-table dev-sakekasu-drinking-records \\
        --bucket dev-sakekasu-images

    # 中身を確かめてから書き込む
    uv run --with boto3 python infra/scripts/migrate_owner_sub.py ... --apply

AWS 認証情報は AWS_PROFILE 等の通常の方法で解決される。
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field

# Cognito の sub は UUID。形を確かめるのは、取り違え（ユーザー名やメールアドレス、
# 空文字）でバケット全体を前方一致で拾うような事故を防ぐため
SUB_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)

# presigned-url Lambda と infra/lib/image-constants.ts の一時領域と揃える
TEMP_LOCATION = "tmp"

# 例として表示する件数
EXAMPLE_LIMIT = 5


# ---------------------------------------------------------------------------
# 純粋関数（AWS に触らない。tests/test_migrate_owner_sub.py が見ている）
# ---------------------------------------------------------------------------


def validate_subs(old_sub: str, new_sub: str) -> None:
    """旧 sub と新 sub の形を確かめる。おかしければ ValueError。"""
    for label, value in (("--old-sub", old_sub), ("--new-sub", new_sub)):
        if not SUB_PATTERN.match(value):
            raise ValueError(f"{label} が sub（小文字の UUID）の形をしていない: {value!r}")
    if old_sub == new_sub:
        raise ValueError("--old-sub と --new-sub が同じ")


def rewrite_key(key: str, old_sub: str, new_sub: str) -> str:
    """画像キーの先頭の旧 sub を新 sub に置き換える。旧 sub で始まらないキーはそのまま。"""
    prefix = f"{old_sub}/"
    if key.startswith(prefix):
        return f"{new_sub}/{key[len(prefix):]}"
    return key


def s3_copy_target(key: str, old_sub: str, new_sub: str) -> str | None:
    """S3 のキーの写し先。写さないもの（旧 sub の外・一時領域）は None。"""
    prefix = f"{old_sub}/"
    if not key.startswith(prefix):
        return None
    rest = key[len(prefix):]
    if rest == "" or rest.startswith(f"{TEMP_LOCATION}/"):
        return None
    return f"{new_sub}/{rest}"


@dataclass
class ItemUpdate:
    """1項目ぶんの書き換え。DynamoDB の低レベル形式（{"S": ...}）で持つ。"""

    key: dict
    values: dict
    condition_updated_at: dict | None
    # 旧 sub で始まらない画像キー（持ち主の確かめに通らないので、表示できない見込み）
    foreign_image_keys: list[str] = field(default_factory=list)


def plan_item_update(item: dict, old_sub: str, new_sub: str) -> ItemUpdate | None:
    """記録1件の書き換え内容を決める。旧 sub の項目でなければ None。

    item は DynamoDB の低レベル形式（scan / query の Items の1要素）。
    """
    if item.get("owner", {}).get("S") != old_sub:
        return None

    values: dict = {"owner": {"S": new_sub}}
    foreign: list[str] = []

    single = item.get("imageKey", {}).get("S")
    if single:
        values["imageKey"] = {"S": rewrite_key(single, old_sub, new_sub)}
        if not single.startswith(f"{old_sub}/"):
            foreign.append(single)

    if "imageKeys" in item and "L" in item["imageKeys"]:
        rewritten = []
        for element in item["imageKeys"]["L"]:
            value = element.get("S")
            if value is None:
                # NULL など、文字列でない要素は形を保ったまま残す
                rewritten.append(element)
                continue
            rewritten.append({"S": rewrite_key(value, old_sub, new_sub)})
            if not value.startswith(f"{old_sub}/"):
                foreign.append(value)
        values["imageKeys"] = {"L": rewritten}

    return ItemUpdate(
        key={"id": item["id"]},
        values=values,
        condition_updated_at=item.get("updatedAt"),
        foreign_image_keys=foreign,
    )


def build_update_request(table: str, update: ItemUpdate, old_sub: str) -> dict:
    """UpdateItem の引数を組み立てる。

    条件は「owner がまだ旧 sub」かつ「読んだあとに updatedAt が変わっていない」。
    前者で、付け替え済みの項目や他人の項目を書き換えない。後者で、読んでから
    書くまでの間に画面から編集された項目の画像キーを、古い値で上書きしない
    """
    names = {}
    values = {":oldOwner": {"S": old_sub}}
    sets = []
    for index, (attr, value) in enumerate(sorted(update.values.items())):
        names[f"#a{index}"] = attr
        values[f":v{index}"] = value
        sets.append(f"#a{index} = :v{index}")

    names["#owner"] = "owner"
    names["#updatedAt"] = "updatedAt"
    if update.condition_updated_at is None:
        condition = "#owner = :oldOwner AND attribute_not_exists(#updatedAt)"
    else:
        values[":readUpdatedAt"] = update.condition_updated_at
        condition = "#owner = :oldOwner AND #updatedAt = :readUpdatedAt"

    return {
        "TableName": table,
        "Key": update.key,
        "UpdateExpression": "SET " + ", ".join(sets),
        "ConditionExpression": condition,
        "ExpressionAttributeNames": names,
        "ExpressionAttributeValues": values,
    }


def without_owner(key: str) -> str:
    """表示するキーから先頭の sub を落とす（cleanup-orphan-images.py と同じ規則）。"""
    _owner, sep, rest = key.partition("/")
    return rest if sep else "(想定外の形のキー)"


# ---------------------------------------------------------------------------
# AWS とのやり取り
# ---------------------------------------------------------------------------


def query_owner_items(dynamodb, table: str, owner: str) -> list[dict]:
    """owner-index で、その sub の記録を最後まで読む。"""
    items = []
    kwargs = {
        "TableName": table,
        "IndexName": "owner-index",
        "KeyConditionExpression": "#owner = :owner",
        "ExpressionAttributeNames": {"#owner": "owner"},
        "ExpressionAttributeValues": {":owner": {"S": owner}},
    }
    while True:
        result = dynamodb.query(**kwargs)
        items.extend(result["Items"])
        last = result.get("LastEvaluatedKey")
        if not last:
            return items
        kwargs["ExclusiveStartKey"] = last


def list_keys(s3, bucket: str, prefix: str) -> list[str]:
    keys = []
    token = None
    while True:
        kwargs = {"Bucket": bucket, "Prefix": prefix}
        if token:
            kwargs["ContinuationToken"] = token
        result = s3.list_objects_v2(**kwargs)
        keys.extend(obj["Key"] for obj in result.get("Contents", []))
        if not result.get("IsTruncated"):
            return keys
        token = result["NextContinuationToken"]


def object_exists(s3, bucket: str, key: str) -> bool:
    from botocore.exceptions import ClientError

    try:
        s3.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as err:
        if err.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return False
        raise


def migrate_images(s3, bucket: str, old_sub: str, new_sub: str, apply: bool) -> int:
    """画像を写す。戻り値は失敗の件数。"""
    keys = list_keys(s3, bucket, f"{old_sub}/")
    pairs = [(k, s3_copy_target(k, old_sub, new_sub)) for k in keys]
    targets = [(src, dst) for src, dst in pairs if dst is not None]
    skipped_temp = len(keys) - len(targets)

    print(f"\n[S3] {bucket}")
    print(f"  旧 sub の下のオブジェクト: {len(keys)} 件（うち一時領域で写さないもの {skipped_temp} 件）")

    copied = existed = failed = 0
    for src, dst in targets:
        if object_exists(s3, bucket, dst):
            existed += 1
            continue
        if copied < EXAMPLE_LIMIT:
            print(f"  {'コピー' if apply else 'コピー予定'}: {without_owner(src)}")
        if apply:
            try:
                # 既定の MetadataDirective / TaggingDirective は COPY。
                # Content-Type もタグも元のまま引き継ぐ
                s3.copy_object(
                    Bucket=bucket,
                    Key=dst,
                    CopySource={"Bucket": bucket, "Key": src},
                )
            except Exception as err:  # noqa: BLE001 - 1件の失敗で全体を止めない
                failed += 1
                print(f"  失敗: {without_owner(src)}: {err}", file=sys.stderr)
                continue
        copied += 1

    verb = "コピーした" if apply else "コピーする"
    print(f"  {verb}: {copied} 件 / 新しいキーにすでにある: {existed} 件 / 失敗: {failed} 件")
    return failed


def migrate_table(dynamodb, table: str, old_sub: str, new_sub: str, apply: bool) -> int:
    """記録の owner と画像キーを付け替える。戻り値は失敗の件数。"""
    old_items = query_owner_items(dynamodb, table, old_sub)
    already = query_owner_items(dynamodb, table, new_sub)
    updates = [u for u in (plan_item_update(i, old_sub, new_sub) for i in old_items) if u]

    print(f"\n[DynamoDB] {table}")
    print(f"  旧 sub の記録: {len(updates)} 件 / 新 sub の記録（すでにある）: {len(already)} 件")

    foreign = [k for u in updates for k in u.foreign_image_keys]
    if foreign:
        print(f"  注意: 旧 sub で始まらない画像キーが {len(foreign)} 件ある（書き換えずに残す）")

    for update in updates[:EXAMPLE_LIMIT]:
        record_id = update.key["id"]["S"]
        image_count = len(update.values.get("imageKeys", {}).get("L", [])) or (
            1 if "imageKey" in update.values else 0
        )
        print(f"  例: id={record_id} 画像キー {image_count} 件")

    if not apply:
        return 0

    from botocore.exceptions import ClientError

    done = conflicted = failed = 0
    for update in updates:
        try:
            dynamodb.update_item(**build_update_request(table, update, old_sub))
            done += 1
        except ClientError as err:
            if err.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
                # 付け替え済み、または読んだあとに画面から編集された。
                # もう一度流せば、まだ旧 sub のものだけが拾われる
                conflicted += 1
                continue
            failed += 1
            print(f"  失敗: id={update.key['id']['S']}: {err}", file=sys.stderr)

    print(f"  書き換えた: {done} 件 / 条件で見送った: {conflicted} 件 / 失敗: {failed} 件")
    if conflicted:
        print("  見送ったものがあるので、もう一度流して 0 件になるのを確かめること")
    return failed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="記録と画像の持ち主を旧 sub から新 sub へ付け替える（既定は dry-run）"
    )
    parser.add_argument("--old-sub", required=True, help="旧ユーザープールでの sub")
    parser.add_argument("--new-sub", required=True, help="共通ログインのユーザープールでの sub")
    parser.add_argument("--purchase-table", required=True)
    parser.add_argument("--drinking-table", required=True)
    parser.add_argument("--bucket", required=True, help="画像バケット")
    parser.add_argument("--region", default="ap-northeast-1")
    parser.add_argument("--apply", action="store_true", help="実際に書き込む（無ければ dry-run）")
    args = parser.parse_args(argv)

    try:
        validate_subs(args.old_sub, args.new_sub)
    except ValueError as err:
        print(f"エラー: {err}", file=sys.stderr)
        return 2

    import boto3

    session = boto3.Session(region_name=args.region)
    s3 = session.client("s3")
    dynamodb = session.client("dynamodb")

    print("モード:", "書き込み（--apply）" if args.apply else "dry-run（何も書かない）")

    # 画像を先に揃えてから、記録の指す先を切り替える
    failed = migrate_images(s3, args.bucket, args.old_sub, args.new_sub, args.apply)
    if failed and args.apply:
        print("\n画像のコピーに失敗したものがあるので、記録の付け替えには進まない", file=sys.stderr)
        return 1

    for table in (args.purchase_table, args.drinking_table):
        failed += migrate_table(dynamodb, table, args.old_sub, args.new_sub, args.apply)

    if not args.apply:
        print("\ndry-run なので何も書いていない。内容を確かめてから --apply を付けて流す")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
