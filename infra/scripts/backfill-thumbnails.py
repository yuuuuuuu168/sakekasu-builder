#!/usr/bin/env python3
"""既存画像のサムネイルを生成して S3 に保存する（一度きりのバックフィル）。

一覧表示はサムネイル（`thumb_` プレフィックス付きの兄弟キー）を優先して
読み込むが、この仕組みの導入前にアップロードされた画像にはサムネイルが
存在せず原画（最大 5MB）にフォールバックしてしまう。
このスクリプトで既存分を埋めることで、過去の記録も軽い画像で表示できる。

使い方:
    uv run --with boto3 --with pillow \\
        python infra/scripts/backfill-thumbnails.py --bucket dev-sakekasu-images

    # 実際に書き込まず対象だけ確認する
    uv run --with boto3 --with pillow \\
        python infra/scripts/backfill-thumbnails.py --bucket dev-sakekasu-images --dry-run

AWS 認証情報は AWS_PROFILE 等の通常の方法で解決される。
"""

import argparse
import io
import sys

import boto3
from PIL import Image

# フロントエンド（src/features/image/）と揃える必要がある定数
THUMBNAIL_PREFIX = "thumb_"
THUMBNAIL_MAX_EDGE = 320
THUMBNAIL_QUALITY = 70


def to_thumbnail_key(key: str) -> str:
    """原画キーからサムネイルキーを導出する（フロントエンドと同じ規則）。"""
    head, sep, file_name = key.rpartition("/")
    return f"{head}{sep}{THUMBNAIL_PREFIX}{file_name}"


def is_thumbnail(key: str) -> bool:
    return key.rpartition("/")[2].startswith(THUMBNAIL_PREFIX)


def make_thumbnail(data: bytes) -> bytes:
    """画像バイト列から長辺 320px の JPEG サムネイルを作る。"""
    with Image.open(io.BytesIO(data)) as img:
        img = img.convert("RGB")
        img.thumbnail((THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE))
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=THUMBNAIL_QUALITY, optimize=True)
        return buffer.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bucket", required=True, help="画像バケット名")
    parser.add_argument("--region", default="ap-northeast-1")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="S3 に書き込まず、対象と削減見込みだけ表示する",
    )
    args = parser.parse_args()

    s3 = boto3.client("s3", region_name=args.region)

    processed = skipped = failed = 0
    original_bytes = thumbnail_bytes = 0

    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=args.bucket):
        contents = page.get("Contents", [])
        keys = {obj["Key"] for obj in contents}

        for obj in contents:
            key = obj["Key"]
            if is_thumbnail(key):
                continue

            thumb_key = to_thumbnail_key(key)
            # 同じページ内に既にサムネイルがあればスキップ（再実行しても安全）
            if thumb_key in keys:
                skipped += 1
                continue

            try:
                body = s3.get_object(Bucket=args.bucket, Key=key)["Body"].read()
                thumb = make_thumbnail(body)
            except Exception as err:  # 画像でないオブジェクト等は飛ばす
                print(f"  失敗 {key}: {err}", file=sys.stderr)
                failed += 1
                continue

            original_bytes += len(body)
            thumbnail_bytes += len(thumb)

            if not args.dry_run:
                s3.put_object(
                    Bucket=args.bucket,
                    Key=thumb_key,
                    Body=thumb,
                    ContentType="image/jpeg",
                )

            processed += 1
            print(f"  {key} -> {thumb_key} ({len(body):,} → {len(thumb):,} bytes)")

    mode = "対象（未書き込み）" if args.dry_run else "生成"
    print(f"\n{mode}: {processed} 件 / スキップ（既存）: {skipped} 件 / 失敗: {failed} 件")
    if processed and original_bytes:
        reduction = 100 - thumbnail_bytes * 100 / original_bytes
        print(
            f"合計サイズ: {original_bytes:,} → {thumbnail_bytes:,} bytes "
            f"（{reduction:.1f}% 削減）"
        )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
