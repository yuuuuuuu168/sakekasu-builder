#!/usr/bin/env python3
"""どの記録からも参照されていない画像を S3 から消す（Issue #132 の既存分の掃除）。

孤児になる経路は2つある。

A. 記録を削除したときに原画だけを消していて、サムネイルが残る
   （`thumb_` は記録に保存されず原画から導出する兄弟キーのため、
   削除対象に入っていなかった。Lambda 側は修正済み）

B. OCR 解析のために記録の作成前にアップロードし、保存せず離脱する
   （どの記録からも参照されないまま残る）

判定は「記録が参照する原画キーの集合」を基準に行う。

- 原画 K   … K が参照されていれば残す。されていなければ孤児
- thumb_K  … 元の原画 K が参照されていれば残す。されていなければ孤児

使い方:
    uv run --with boto3 python infra/scripts/cleanup-orphan-images.py \\
        --bucket dev-sakekasu-images \\
        --purchase-table dev-sakekasu-purchase-records \\
        --drinking-table dev-sakekasu-drinking-records --dry-run

    # 実際に消す（消える前に必ず --dry-run の一覧を確認すること）
    uv run --with boto3 python infra/scripts/cleanup-orphan-images.py \\
        --bucket dev-sakekasu-images \\
        --purchase-table dev-sakekasu-purchase-records \\
        --drinking-table dev-sakekasu-drinking-records --apply

AWS 認証情報は AWS_PROFILE 等の通常の方法で解決される。
"""

import argparse
import sys

import boto3

# フロントエンド（src/features/image/lib/thumbnailKey.ts）と揃える必要がある
THUMBNAIL_PREFIX = "thumb_"


def is_thumbnail(key: str) -> bool:
    return key.rpartition("/")[2].startswith(THUMBNAIL_PREFIX)


def to_original_key(thumbnail_key: str) -> str:
    """サムネイルキーから元の原画キーを戻す。"""
    head, sep, file_name = thumbnail_key.rpartition("/")
    return f"{head}{sep}{file_name[len(THUMBNAIL_PREFIX):]}"


def effective_image_keys(item: dict) -> list[str]:
    """記録が実際に表示に使う画像キーを返す。

    imageKeys(複数) があればそれを、無ければ imageKey(単数) を使う。
    フロントエンドの normalizeImageKeys と同じ規則。単数しか持たない
    古い記録を数え落とすと、生きている画像を消してしまう。
    """
    keys = [v["S"] for v in item.get("imageKeys", {}).get("L", []) if v.get("S")]
    if keys:
        return keys
    single = item.get("imageKey", {}).get("S")
    return [single] if single else []


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


def list_all_objects(s3, bucket: str) -> list[dict]:
    """バケットのオブジェクトを最後まで列挙する。"""
    objects = []
    token = None
    while True:
        kwargs = {"Bucket": bucket}
        if token:
            kwargs["ContinuationToken"] = token
        result = s3.list_objects_v2(**kwargs)
        objects.extend(result.get("Contents", []))
        if not result.get("IsTruncated"):
            return objects
        token = result["NextContinuationToken"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--purchase-table", required=True)
    parser.add_argument("--drinking-table", required=True)
    parser.add_argument("--region", default="ap-northeast-1")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true", help="対象を表示するだけ")
    group.add_argument("--apply", action="store_true", help="実際に削除する")
    args = parser.parse_args()

    session = boto3.session.Session(region_name=args.region)
    s3 = session.client("s3")
    dynamodb = session.client("dynamodb")

    referenced: set[str] = set()
    for table in (args.purchase_table, args.drinking_table):
        for item in scan_all(dynamodb, table):
            referenced.update(effective_image_keys(item))

    objects = list_all_objects(s3, args.bucket)

    # 参照が1件も取れないときは、走査の失敗を疑う。そのまま進めると
    # バケットを全消しすることになる
    if not referenced:
        print("記録が参照する画像が1件も見つからない。中止する", file=sys.stderr)
        return 1

    orphan_originals = []
    orphan_thumbnails = []
    kept = 0

    for obj in objects:
        key = obj["Key"]
        source = to_original_key(key) if is_thumbnail(key) else key

        if source in referenced:
            kept += 1
            continue

        (orphan_thumbnails if is_thumbnail(key) else orphan_originals).append(obj)

    def total_mb(items: list[dict]) -> float:
        return sum(o["Size"] for o in items) / 1024 / 1024

    print(f"S3 のオブジェクト     : {len(objects)} 件")
    print(f"記録が参照する原画    : {len(referenced)} 件")
    print(f"残す                  : {kept} 件")
    print(f"孤児（原画）          : {len(orphan_originals)} 件 / {total_mb(orphan_originals):.1f} MB")
    print(f"孤児（サムネイル）    : {len(orphan_thumbnails)} 件 / {total_mb(orphan_thumbnails):.2f} MB")
    print()

    targets = orphan_originals + orphan_thumbnails
    if not targets:
        print("消すものは無い")
        return 0

    for obj in sorted(targets, key=lambda o: o["Key"]):
        # 先頭の sub は伏せる。ログや端末に利用者の識別子を残さない
        shown = obj["Key"].split("/", 1)[1] if "/" in obj["Key"] else obj["Key"]
        print(f"  {obj['Size'] / 1024 / 1024:7.2f} MB  {shown}")

    if not args.apply:
        print()
        print("--dry-run のため何も消していない")
        return 0

    # delete_objects は1回 1000 件まで
    deleted = 0
    for i in range(0, len(targets), 1000):
        chunk = targets[i : i + 1000]
        response = s3.delete_objects(
            Bucket=args.bucket,
            Delete={"Objects": [{"Key": o["Key"]} for o in chunk], "Quiet": True},
        )
        errors = response.get("Errors", [])
        deleted += len(chunk) - len(errors)
        for error in errors:
            print(f"  [!] 消せなかった: {error.get('Key')} ({error.get('Message')})")

    print()
    print(f"削除した: {deleted} 件 / {total_mb(targets):.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
