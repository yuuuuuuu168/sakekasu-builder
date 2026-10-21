"""購入記録・飲酒記録（DynamoDB）の読み出しと、モデル向けの整形。

記録のテーブルは IAM で行を絞れないので、本人の記録だけを読むのは
owner-index を検証済みの sub で引く _query_owner_items の役目になる。
"""

from decimal import Decimal
from typing import Optional

import boto3

from config import AWS_REGION, DRINKING_TABLE_NAME, PURCHASE_TABLE_NAME
from sanitize import _RAW_TRUNCATE_FACTOR, _UNSAFE_TEXT_PLACEHOLDER, _neutralize_text

# 悪用時のコスト増幅・リソース枯渇を抑える上限
MAX_QUERY_PAGES = 10
MAX_MEMO_LENGTH = 200
MAX_TEXT_FIELD_LENGTH = 120


_dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
_purchase_table = _dynamodb.Table(PURCHASE_TABLE_NAME)
_drinking_table = _dynamodb.Table(DRINKING_TABLE_NAME)


# モデルに渡す購入記録のフィールド（トークン節約と不要情報の遮断）
_PURCHASE_RECORD_FIELDS = (
    "sakeName",
    "storeName",
    "price",
    "quantity",
    # まだ飲みきっていない本数。まとめ買いを1本ずつ消費できるようにしたため、
    # 在庫として残っているのは quantity ではなくこちら（未設定なら quantity と同じ）
    "remainingQuantity",
    "purchaseDate",
    "category",
    "memo",
    "drinkingStatus",
    "openedAt",
)

# モデルに渡す飲酒記録のフィールド（好みの推測に使う評価・感想を含める）
_DRINKING_RECORD_FIELDS = (
    "sakeName",
    "placeName",
    "price",
    "drinkingDate",
    "category",
    "drinkingMethod",
    "rating",
    "memo",
)

_VALID_CATEGORIES = frozenset({"NIHONSHU", "BEER", "WINE", "WHISKY", "SHOCHU", "OTHER"})
_VALID_STATUSES = frozenset({"NOT_STARTED", "IN_PROGRESS", "FINISHED"})
# rating の有効範囲（フロントは 1〜5 の星評価）
_RATING_MIN = 1
_RATING_MAX = 5

# ユーザーが自由入力できるフィールド（プロンプトインジェクション対策の対象）。
# drinkingMethod は UI 上は選択式だが、GraphQL API としては任意の文字列を
# 受け付けるため自由入力とみなして無害化する
_USER_TEXT_FIELDS = frozenset(
    {"sakeName", "storeName", "placeName", "drinkingMethod", "memo"}
)


def _to_plain(value):
    """DynamoDB の Decimal を JSON シリアライズ可能な数値に変換する。"""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    return value


def _slim_record(item: dict, fields: tuple) -> dict:
    """記録をモデル向けに必要フィールドだけへ絞り込む。

    ユーザー入力由来の文字列（_USER_TEXT_FIELDS）は長さ上限で
    切り詰め、山括弧を全角に無害化した上で <user_data> デリミタで囲み、
    データと指示の境界を明示する。無害化により値の中に </user_data> を
    仕込んでも境界をエスケープできない。
    """
    slim = {}
    for key in fields:
        value = item.get(key)
        if value is None:
            continue
        value = _to_plain(value)
        if key in _USER_TEXT_FIELDS and isinstance(value, str):
            limit = MAX_MEMO_LENGTH if key == "memo" else MAX_TEXT_FIELD_LENGTH
            # 正規化前に粗く切り詰めて、巨大な保存値による CPU 増幅を防ぐ
            # （NFKC 展開分の余裕を持たせてから、正規化後に本来の上限で切る）
            raw = value[: limit * _RAW_TRUNCATE_FACTOR]
            safe = _neutralize_text(raw)
            body = _UNSAFE_TEXT_PLACEHOLDER if safe is None else safe[:limit]
            value = f"<user_data>{body}</user_data>"
        slim[key] = value
    return slim


def _normalize_enum(value: Optional[str], valid: frozenset, label: str):
    """enum 引数を正規化して検証する。戻り値は (正規化済み値, エラー文字列)。"""
    if value is None:
        return None, None
    normalized = value.strip().upper()
    if not normalized:
        return None, None
    if normalized not in valid:
        # 不正値をエラー文へそのまま埋め込むと、無害化を通らない文字列が
        # ツール結果として LLM 文脈に反射するため、値は返さず有効値だけ示す
        return None, f"{label} が不正です。有効な値: {', '.join(sorted(valid))}"
    return normalized, None


def _query_owner_items(table, owner_sub: str) -> list:
    """owner-index GSI でユーザーの記録を全件取得する。

    1MB 境界で分割されても全件取得する（暴走防止の上限つき）。
    """
    items = []
    query_kwargs = {
        "IndexName": "owner-index",
        "KeyConditionExpression": "#owner = :owner",
        "ExpressionAttributeNames": {"#owner": "owner"},
        "ExpressionAttributeValues": {":owner": owner_sub},
    }
    for _ in range(MAX_QUERY_PAGES):
        response = table.query(**query_kwargs)
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break
        query_kwargs["ExclusiveStartKey"] = last_key
    return items
