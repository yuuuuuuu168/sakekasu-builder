"""パーソナル酒ソムリエ AgentCore Runtime エントリポイント。

在庫相談 MVP: ユーザーの購入記録（DynamoDB）を参照して、
状況に合わせた「今何を飲むべきか」の相談に答える。
"""

import base64
import json
import os
from decimal import Decimal
from typing import Optional

import boto3
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent, tool

from model.load import load_model

app = BedrockAgentCoreApp()
log = app.logger

TABLE_NAME = os.getenv("PURCHASE_TABLE_NAME", "dev-sakekasu-purchase-records")
AWS_REGION = os.getenv("AWS_REGION", "ap-northeast-1")

_dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
_purchase_table = _dynamodb.Table(TABLE_NAME)


SYSTEM_PROMPT = """あなたはお酒の専門家・パーソナル酒ソムリエです。
ユーザーの購入記録を踏まえて、「今何を飲もうか」という相談に答えてください。

# 使えるツール
- list_my_purchase_records(category?, drinking_status?)
  ユーザーの購入記録を取得する。カテゴリや飲みきりステータスで絞り込み可能。

# カテゴリ
NIHONSHU（日本酒）, BEER（ビール）, WINE（ワイン）, WHISKY（ウイスキー）, SHOCHU（焼酎）, OTHER（その他）

# 飲みきりステータス
NOT_STARTED（未開封）, IN_PROGRESS（飲み中）, FINISHED（飲みきり）

# 振る舞い
- 相談内容（気温・料理・気分）を汲み取って、手持ちから 1〜3 本おすすめする
- 飲み中（IN_PROGRESS）のものがあれば劣化防止のため優先的に提案する
- 手持ちに合うものがなければ、正直にそう伝える
- 日本語で、親しみやすいトーンで答える
"""


def _get_owner_sub(context) -> str:
    """JWT の sub クレームまたはローカル開発用の環境変数から owner_sub を取得。

    デプロイ時: JWT Inbound Auth を通過した Authorization ヘッダーが
    context.request_headers に入って届くため、ペイロードから sub を取り出す。
    署名検証は AgentCore Runtime の JWT Authorizer 側で完了している前提のため、
    ここでは再検証しない（Authorizer 未設定でのデプロイは禁止）。
    ローカル dev: LOCAL_DEV_OWNER_SUB 環境変数で任意の Cognito sub を指定可能。
    """
    headers = getattr(context, "request_headers", None) or {}
    auth = next((v for k, v in headers.items() if k.lower() == "authorization"), "")
    if auth.startswith("Bearer "):
        token = auth[len("Bearer "):]
        try:
            payload_b64 = token.split(".")[1]
            payload_b64 += "=" * (-len(payload_b64) % 4)
            claims = json.loads(base64.urlsafe_b64decode(payload_b64))
            sub = claims.get("sub")
            if sub:
                return sub
        except (IndexError, ValueError) as err:
            log.warning("JWT ペイロードの解析に失敗: %s", err)
    return os.getenv("LOCAL_DEV_OWNER_SUB", "")


# モデルに渡す購入記録のフィールド（トークン節約と不要情報の遮断）
_RECORD_FIELDS = (
    "sakeName",
    "storeName",
    "price",
    "quantity",
    "purchaseDate",
    "category",
    "memo",
    "drinkingStatus",
    "openedAt",
)


def _to_plain(value):
    """DynamoDB の Decimal を JSON シリアライズ可能な数値に変換する。"""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    return value


def _slim_record(item: dict) -> dict:
    """購入記録をモデル向けに必要フィールドだけへ絞り込む。"""
    return {k: _to_plain(item[k]) for k in _RECORD_FIELDS if item.get(k) is not None}


def _build_purchase_records_tool(owner_sub: str):
    """owner_sub をクロージャで固定した購入記録取得 Tool を生成する。

    リクエストごとに生成することで、マルチユーザー環境での sub の混線を防ぐ。
    """

    @tool
    def list_my_purchase_records(
        category: Optional[str] = None,
        drinking_status: Optional[str] = None,
    ) -> list:
        """あなた（認証済みユーザー）の購入記録一覧を取得します。

        Args:
            category: (任意) カテゴリで絞り込み。NIHONSHU / BEER / WINE / WHISKY / SHOCHU / OTHER
            drinking_status: (任意) 飲みきりステータスで絞り込み。NOT_STARTED / IN_PROGRESS / FINISHED

        Returns:
            購入記録のリスト。各項目は sakeName, storeName, price, purchaseDate,
            category, memo, drinkingStatus などを含む。
        """
        if not owner_sub:
            return {"error": "認証情報（owner_sub）が取得できません"}

        items = []
        try:
            query_kwargs = {
                "IndexName": "owner-index",
                "KeyConditionExpression": "#owner = :owner",
                "ExpressionAttributeNames": {"#owner": "owner"},
                "ExpressionAttributeValues": {":owner": owner_sub},
            }
            # 1MB 境界で分割されても全件取得する
            while True:
                response = _purchase_table.query(**query_kwargs)
                items.extend(response.get("Items", []))
                last_key = response.get("LastEvaluatedKey")
                if not last_key:
                    break
                query_kwargs["ExclusiveStartKey"] = last_key
        except Exception as err:
            log.error("DynamoDB query failed: %s", err)
            return {"error": "購入記録の取得に失敗しました"}

        if category:
            items = [i for i in items if i.get("category") == category]
        if drinking_status:
            items = [i for i in items if i.get("drinkingStatus") == drinking_status]
        return [_slim_record(i) for i in items]

    return list_my_purchase_records


@app.entrypoint
async def invoke(payload, context):
    log.info("Invoking sommelier agent")

    owner_sub = _get_owner_sub(context)
    tool_fn = _build_purchase_records_tool(owner_sub)

    agent = Agent(
        model=load_model(),
        system_prompt=SYSTEM_PROMPT,
        tools=[tool_fn],
    )

    stream = agent.stream_async(payload.get("prompt", ""))
    async for event in stream:
        if "data" in event and isinstance(event["data"], str):
            yield event["data"]


if __name__ == "__main__":
    app.run()
