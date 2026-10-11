"""ソムリエが Claude を呼ぶ先（Claude API / Bedrock）を決める。

呼び先は 2 つで、どちらも Strands のモデルとして同じ Agent に渡せる。

- anthropic: Claude API（api.anthropic.com）。Max プランに付く月々のクレジットで払う。既定
- bedrock: Amazon Bedrock の Claude。クレジット切れや障害のときの控え

Claude API には API キーを持たずに入る（Workload Identity Federation）。Runtime の
実行ロールで STS の GetWebIdentityToken を呼んで AWS が署名した JWT をもらい、SDK が
Anthropic の短命のトークンと交換する。期限が来れば SDK が自分で交換し直す。
手順は docs/claude-api.md にある。

ID 連携の値（ANTHROPIC_FEDERATION_RULE_ID ほか）が揃っていなければ Bedrock だけで動く。
Claude Console の設定が済む前でも相談そのものは止めないため。

Claude API が失敗したときに Bedrock でやり直すかどうかは fallback_reason で決める。
やり直すのは応答を流し始める前に失敗したときだけで、判断は main.py が持つ。
"""

import os
from dataclasses import dataclass
from typing import Optional

import anthropic
import boto3
from anthropic.lib.credentials import WorkloadIdentityCredentials
from strands.models import CacheConfig
from strands.models.anthropic import AnthropicModel
from strands.models.bedrock import BedrockModel
from strands.types.exceptions import EventLoopException, ModelThrottledException

# 控えの Bedrock のモデル。東京リージョン CRIS プレフィックス付き Claude Haiku 4.5。
# 切り替え前に使っていたもので、OCR・テイスティングノートの控えと揃える
DEFAULT_BEDROCK_MODEL_ID = "jp.anthropic.claude-haiku-4-5-20251001-v1:0"

# Claude API のモデル。Haiku 5.5 から始め、品質を見て ANTHROPIC_MODEL_CHAT で上げる
DEFAULT_ANTHROPIC_MODEL_CHAT = "claude-haiku-5-5"

# STS に頼む ID トークン（JWT）の宛先と寿命。実行ロールの権限の条件
# （sommelier/agentcore/cdk/lib/cdk-stack.ts）と、Claude Console のルールの audience と揃える
IDENTITY_TOKEN_AUDIENCE = "https://api.anthropic.com"
IDENTITY_TOKEN_SECONDS = 300

# 1 回の応答で出してよい長さ。思考（adaptive thinking）の分も含む。
# 応答はストリーミングで返すので、長くても HTTP のタイムアウトにはかからない
MAX_TOKENS = 8192

# Claude API の 1 回の待ち時間（秒）。ストリーミングの最初の応答までにかかる時間の上限で、
# これを超えたら Bedrock でやり直す。普段は数秒で返り始める
ANTHROPIC_TIMEOUT_SECONDS = 30


@dataclass(frozen=True)
class Federation:
    rule_id: str
    organization_id: str
    service_account_id: str
    workspace_id: Optional[str] = None


@dataclass(frozen=True)
class LlmConfig:
    provider: str
    anthropic_model: str
    bedrock_model: str
    federation: Optional[Federation] = None


def read_llm_config(env=None) -> LlmConfig:
    """環境変数から呼び先を決める。

    LLM_PROVIDER が anthropic（既定）でも、ID 連携の値が揃っていなければ Bedrock だけで動く。
    """
    env = os.environ if env is None else env
    bedrock_model = env.get("BEDROCK_MODEL_ID") or DEFAULT_BEDROCK_MODEL_ID
    anthropic_model = env.get("ANTHROPIC_MODEL_CHAT") or DEFAULT_ANTHROPIC_MODEL_CHAT

    rule_id = env.get("ANTHROPIC_FEDERATION_RULE_ID")
    organization_id = env.get("ANTHROPIC_ORGANIZATION_ID")
    service_account_id = env.get("ANTHROPIC_SERVICE_ACCOUNT_ID")
    federation = None
    if rule_id and organization_id and service_account_id:
        federation = Federation(
            rule_id=rule_id,
            organization_id=organization_id,
            service_account_id=service_account_id,
            workspace_id=env.get("ANTHROPIC_WORKSPACE_ID") or None,
        )

    wanted = "bedrock" if env.get("LLM_PROVIDER") == "bedrock" else "anthropic"
    provider = "anthropic" if wanted == "anthropic" and federation else "bedrock"
    return LlmConfig(
        provider=provider,
        anthropic_model=anthropic_model,
        bedrock_model=bedrock_model,
        federation=federation,
    )


def fallback_reason(error: BaseException) -> Optional[str]:
    """Bedrock でやり直すべき失敗なら、その種類を返す。やり直さない失敗なら None。

    種類はログ（[llm] fallback）の errorType にそのまま出し、CloudWatch で数える。
    残高不足以外の 400 はこちらの頼み方の誤りなので、やり直さない
    （Bedrock でも同じく弾かれるだけで、誤りが見えなくなる）。
    """
    # Strands はモデルの失敗をイベントループの中で EventLoopException に包み直して上げる
    # ことがある。包んだままだとどの種類にも当たらず、やり直さずに失敗してしまう
    error = root_error(error)
    # Strands は 429 を ModelThrottledException に包み直す
    if isinstance(error, ModelThrottledException):
        return "rate_limit"
    if isinstance(error, anthropic.APITimeoutError):
        return "timeout"
    if isinstance(error, anthropic.APIConnectionError):
        return "connection"
    if isinstance(error, anthropic.AuthenticationError):
        return "authentication"
    if isinstance(error, anthropic.PermissionDeniedError):
        return "permission"
    if isinstance(error, anthropic.RateLimitError):
        return "rate_limit"
    if isinstance(error, anthropic.APIStatusError):
        status = error.status_code
        if status == 402:
            return "billing"
        # 残高不足は 400 で返り、本文の文言でしか見分けられない
        if status == 400 and "credit balance is too low" in str(error).lower():
            return "credit_balance"
        if status == 529:
            return "overloaded"
        if status >= 500:
            return "server_error"
        return None
    # 上のどれでもないもの: STS の失敗、トークンの交換の失敗（WorkloadIdentityError）など。
    # 相談の中身とは関係が無い
    if isinstance(error, (anthropic.AnthropicError, boto3.exceptions.Boto3Error)) or _is_botocore_error(
        error
    ):
        return "credentials"
    return None


def root_error(error: BaseException) -> BaseException:
    """EventLoopException の包みを剥がして、元の例外を返す（入れ子でも剥がしきる）"""
    seen = set()
    while isinstance(error, EventLoopException) and id(error) not in seen:
        seen.add(id(error))
        error = error.original_exception
    return error


def _is_botocore_error(error: BaseException) -> bool:
    try:
        from botocore.exceptions import BotoCoreError, ClientError
    except ImportError:  # pragma: no cover - boto3 があれば botocore もある
        return False
    return isinstance(error, (BotoCoreError, ClientError))


def _identity_token_provider(region: str):
    """STS から Anthropic 宛ての ID トークン（JWT）をもらう関数を返す。

    交換のたびに新しい JWT を取る（jti は使い回すと弾かれる）。
    GetWebIdentityToken は地域ごとの STS にしかない。発行者 URL は global なので、どの地域で呼んでも同じ
    """
    sts = boto3.client("sts", region_name=region)

    def provide() -> str:
        response = sts.get_web_identity_token(
            Audience=[IDENTITY_TOKEN_AUDIENCE],
            SigningAlgorithm="RS256",
            DurationSeconds=IDENTITY_TOKEN_SECONDS,
        )
        token = response.get("WebIdentityToken")
        if not token:
            raise RuntimeError("STS が ID トークンを返しませんでした")
        return token

    return provide


def load_anthropic_model(config: LlmConfig, region: str) -> AnthropicModel:
    """Claude API のモデル。

    - SDK の再試行はしない。失敗したら Bedrock でやり直すほうが速い
    - プロンプトキャッシュを効かせる。tool の定義と、システムプロンプトのうち毎回同じ部分
      （main.py が cachePoint で区切る）。1 回の相談の中でも、記録を引く tool を挟むたびに
      同じ前置きでモデルを呼び直すので、相談 1 回の中でも読み直しが安くなる
    - temperature は渡さない。今の世代は既定値以外を 400 で弾く
    """
    federation = config.federation
    if federation is None:
        raise ValueError("ID 連携の値が無いので Claude API のモデルは作れません")
    credentials = WorkloadIdentityCredentials(
        identity_token_provider=_identity_token_provider(region),
        federation_rule_id=federation.rule_id,
        organization_id=federation.organization_id,
        service_account_id=federation.service_account_id,
        workspace_id=federation.workspace_id,
    )
    return AnthropicModel(
        client_args={
            # 交換は同期の HTTP（STS とトークンの交換）だが、非同期のクライアントは
            # それを別スレッドで呼ぶ（SDK の AccessTokenAuth）。イベントループ（＝他の
            # 同時リクエスト）は止まらない
            "credentials": credentials,
            "max_retries": 0,
            "timeout": ANTHROPIC_TIMEOUT_SECONDS,
        },
        model_id=config.anthropic_model,
        max_tokens=MAX_TOKENS,
        # 相談の内容（記録を引いて、理由を添えて薦める）に見合う深さ。Haiku 5.5 の既定と同じだが、
        # モデルを上げたときに既定が変わらないよう明示する
        params={"output_config": {"effort": "medium"}},
        cache_config=CacheConfig(strategy="anthropic", tools_ttl=True),
    )


def load_bedrock_model(config: LlmConfig) -> BedrockModel:
    """Bedrock のモデル（IAM 認証）。切り替え前と同じ"""
    return BedrockModel(model_id=config.bedrock_model)


def load_models(config: Optional[LlmConfig] = None, region: Optional[str] = None) -> list:
    """呼ぶ順に (呼び先, モデル) を並べて返す。先頭で失敗したら次でやり直す。

    Claude API が使えるときは [Claude API, Bedrock]、使えないときは [Bedrock] だけ。
    モデルはリクエストごとに作る（Agent と同じく、相談ごとに状態を持たせない）。
    Claude API のトークンはプロセスの中で使い回す（_anthropic_model のキャッシュ）
    """
    config = config or read_llm_config()
    region = region or os.getenv("AWS_REGION", "ap-northeast-1")
    models = []
    if config.provider == "anthropic":
        models.append(("anthropic", _anthropic_model(config, region)))
    models.append(("bedrock", load_bedrock_model(config)))
    return models


_ANTHROPIC_MODEL_CACHE: dict = {}


def _anthropic_model(config: LlmConfig, region: str) -> AnthropicModel:
    """Claude API のモデルを設定ごとに 1 つだけ作る。

    作るたびに交換し直すと、相談のたびに STS とトークンの交換が走る。トークンは
    クライアントが期限まで持っているので、同じクライアントを使い回す。
    AnthropicModel は呼び出しごとの状態を持たないので、同時の相談で共有してよい
    """
    key = (config, region)
    model = _ANTHROPIC_MODEL_CACHE.get(key)
    if model is None:
        model = load_anthropic_model(config, region)
        _ANTHROPIC_MODEL_CACHE[key] = model
    return model
