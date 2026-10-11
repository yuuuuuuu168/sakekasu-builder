"""呼び先（Claude API / Bedrock）の切り替えと、Bedrock へのフォールバックのテスト。

守りたいのは 4 つ。
- ID 連携の値が揃うまでは Bedrock だけで動く（Claude Console の設定前でも相談を止めない）
- クレジット切れ・認証・障害なら、応答を返し始める前に限って Bedrock でやり直す
- 途中まで返した後の失敗はやり直さない（同じ答えが二重に届くため）
- フォールバックしたら fallback=true の JSON をログに残す（CloudWatch で数える）
"""

import asyncio
import json
import logging

import anthropic
import httpx
import pytest
from strands.models import Model
from strands.models.anthropic import AnthropicModel
from strands.models.bedrock import BedrockModel
from strands.types.exceptions import EventLoopException, ModelThrottledException

import main
from model.load import (
    DEFAULT_ANTHROPIC_MODEL_CHAT,
    DEFAULT_BEDROCK_MODEL_ID,
    fallback_reason,
    load_models,
    read_llm_config,
)

OWNER_SUB = "7a1b2c3d-4e5f-6789-abcd-ef0123456789"

FEDERATION_ENV = {
    "ANTHROPIC_FEDERATION_RULE_ID": "fdrl_test",
    "ANTHROPIC_ORGANIZATION_ID": "00000000-0000-4000-8000-000000000000",
    "ANTHROPIC_SERVICE_ACCOUNT_ID": "svac_test",
}


def status_error(status: int, message: str) -> anthropic.APIStatusError:
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    response = httpx.Response(status, request=request, json={"error": {"message": message}})
    cls = {
        400: anthropic.BadRequestError,
        401: anthropic.AuthenticationError,
        403: anthropic.PermissionDeniedError,
        429: anthropic.RateLimitError,
        500: anthropic.InternalServerError,
    }.get(status, anthropic.APIStatusError)
    return cls(message, response=response, body={"error": {"message": message}})


class TestReadLlmConfig:
    def test_ID連携の値が揃っていればClaude_APIを使う(self):
        config = read_llm_config(dict(FEDERATION_ENV))
        assert config.provider == "anthropic"
        assert config.anthropic_model == DEFAULT_ANTHROPIC_MODEL_CHAT == "claude-haiku-5-5"
        assert config.bedrock_model == DEFAULT_BEDROCK_MODEL_ID
        assert config.federation.rule_id == "fdrl_test"
        assert config.federation.workspace_id is None

    def test_ID連携の値が欠けていればBedrockだけで動く(self):
        env = dict(FEDERATION_ENV)
        del env["ANTHROPIC_SERVICE_ACCOUNT_ID"]
        config = read_llm_config(env)
        assert config.provider == "bedrock"
        assert config.federation is None

    def test_LLM_PROVIDERがbedrockならID連携があってもBedrock(self):
        config = read_llm_config({**FEDERATION_ENV, "LLM_PROVIDER": "bedrock"})
        assert config.provider == "bedrock"

    def test_モデルとワークスペースは環境変数で変えられる(self):
        config = read_llm_config(
            {
                **FEDERATION_ENV,
                "ANTHROPIC_MODEL_CHAT": "claude-sonnet-5-5",
                "ANTHROPIC_WORKSPACE_ID": "wrkspc_test",
                "BEDROCK_MODEL_ID": "jp.anthropic.other",
            }
        )
        assert config.anthropic_model == "claude-sonnet-5-5"
        assert config.federation.workspace_id == "wrkspc_test"
        assert config.bedrock_model == "jp.anthropic.other"


class TestFallbackReason:
    @pytest.mark.parametrize(
        ("error", "expected"),
        [
            (status_error(400, "Your credit balance is too low to access the Anthropic API."), "credit_balance"),
            (status_error(402, "billing"), "billing"),
            (status_error(401, "invalid token"), "authentication"),
            (status_error(403, "forbidden"), "permission"),
            (status_error(429, "rate limited"), "rate_limit"),
            (ModelThrottledException("rate limited"), "rate_limit"),
            (status_error(529, "overloaded"), "overloaded"),
            (status_error(500, "internal"), "server_error"),
            (anthropic.APITimeoutError(httpx.Request("POST", "https://api.anthropic.com")), "timeout"),
            (anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com")), "connection"),
        ],
    )
    def test_Bedrockでやり直す失敗(self, error, expected):
        assert fallback_reason(error) == expected

    def test_Strandsが包み直した失敗も中身で判定する(self):
        # モデルの失敗はイベントループの中で EventLoopException に包まれて上がってくる
        inner = status_error(400, "Your credit balance is too low to access the Anthropic API.")
        assert fallback_reason(EventLoopException(inner)) == "credit_balance"
        assert fallback_reason(EventLoopException(EventLoopException(inner))) == "credit_balance"
        assert fallback_reason(EventLoopException(ValueError("bug"))) is None

    def test_残高不足以外の400はやり直さない(self):
        assert fallback_reason(status_error(400, "messages.0: invalid content")) is None

    def test_相談の処理そのものの失敗はやり直さない(self):
        assert fallback_reason(ValueError("bug")) is None


class TestLoadModels:
    def test_ID連携があればClaude_APIを先にBedrockを控えに並べる(self):
        models = load_models(read_llm_config(dict(FEDERATION_ENV)), region="ap-northeast-1")
        assert [provider for provider, _ in models] == ["anthropic", "bedrock"]
        anthropic_model = models[0][1]
        assert isinstance(anthropic_model, AnthropicModel)
        assert isinstance(models[1][1], BedrockModel)

        config = anthropic_model.get_config()
        assert config["model_id"] == "claude-haiku-5-5"
        # 今の世代は temperature を受け付けない
        assert "temperature" not in (config.get("params") or {})
        # 再試行は SDK に任せず Bedrock でやり直す。API キーではなく ID 連携で入る
        client = anthropic_model.client
        assert client.max_retries == 0
        assert client.api_key is None

    def test_ID連携が無ければBedrockだけ(self):
        models = load_models(read_llm_config({}), region="ap-northeast-1")
        assert [provider for provider, _ in models] == ["bedrock"]

    def test_Claude_APIのモデルは使い回す(self):
        config = read_llm_config(dict(FEDERATION_ENV))
        first = load_models(config, region="ap-northeast-1")[0][1]
        second = load_models(config, region="ap-northeast-1")[0][1]
        # トークンの交換を相談のたびにやり直さない
        assert first is second


class ScriptedAgent:
    """Strands の Agent の代役。呼び先ごとに決めた振る舞いをする。"""

    scripts: dict = {}
    created: list = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.provider = kwargs["model"]
        ScriptedAgent.created.append(self)

    def stream_async(self, agent_input):
        script = ScriptedAgent.scripts[self.provider]

        async def stream():
            # 渡された履歴に書き足す（本物の Agent と同じ）
            self.kwargs["messages"].append({"role": "user", "content": [{"text": "書きかけ"}]})
            for step in script:
                if isinstance(step, BaseException):
                    raise step
                yield {"data": step}

        return stream()


@pytest.fixture
def scripted(monkeypatch):
    ScriptedAgent.scripts = {}
    ScriptedAgent.created = []
    monkeypatch.setattr(main, "Agent", ScriptedAgent)
    # モデルの代わりに呼び先の名前を渡し、ScriptedAgent がそれで振る舞いを選ぶ
    monkeypatch.setattr(main, "load_models", lambda: [("anthropic", "anthropic"), ("bedrock", "bedrock")])
    monkeypatch.setattr(main, "_get_owner_sub", lambda context: OWNER_SUB)
    monkeypatch.setattr(main, "_build_tools", lambda owner_sub, search_enabled=None: [])
    return ScriptedAgent


def invoke(payload):
    from tests.test_invoke_memory import FakeContext

    async def collect():
        return [chunk async for chunk in main.invoke(payload, FakeContext())]

    return asyncio.run(collect())


def fallback_logs(caplog) -> list:
    return [
        json.loads(record.getMessage().split(" ", 2)[2])
        for record in caplog.records
        if record.getMessage().startswith("[llm] fallback ")
    ]


class TestInvokeFallback:
    def test_Claude_APIで答えられたらBedrockは呼ばない(self, scripted, caplog):
        scripted.scripts = {"anthropic": ["燗酒が", "おすすめです"]}

        chunks = invoke({"prompt": "今夜は何を飲もう"})

        assert chunks == ["燗酒が", "おすすめです"]
        assert [agent.provider for agent in scripted.created] == ["anthropic"]
        assert fallback_logs(caplog) == []

    def test_Claude_APIにはキャッシュの区切りつきのシステムプロンプトを渡す(self, scripted):
        scripted.scripts = {"anthropic": ["はい"]}

        invoke({"prompt": "今夜は何を飲もう"})

        kwargs = scripted.created[0].kwargs
        blocks = kwargs["system_prompt"]
        assert blocks[0]["text"].startswith(main.SYSTEM_PROMPT)
        assert blocks[1] == {"cachePoint": {"type": "default"}}
        # Strands の再試行（数分待つ）を止めて、すぐ Bedrock でやり直す
        assert kwargs["retry_strategy"] is None

    def test_クレジット切れならBedrockでやり直してログを残す(self, scripted, caplog):
        caplog.set_level(logging.WARNING)
        scripted.scripts = {
            "anthropic": [status_error(400, "Your credit balance is too low to access the Anthropic API.")],
            "bedrock": ["控えの", "答えです"],
        }

        chunks = invoke({"prompt": "今夜は何を飲もう"})

        assert chunks == ["控えの", "答えです"]
        assert [agent.provider for agent in scripted.created] == ["anthropic", "bedrock"]
        [entry] = fallback_logs(caplog)
        assert entry == {
            "fallback": True,
            "feature": "sommelier",
            "from": "anthropic",
            "to": "bedrock",
            "errorType": "credit_balance",
            "status": 400,
            "message": entry["message"],
        }

    def test_Bedrockには従来どおりの文字列のシステムプロンプトと再試行を渡す(self, scripted):
        scripted.scripts = {
            "anthropic": [status_error(401, "invalid token")],
            "bedrock": ["はい"],
        }

        invoke({"prompt": "今夜は何を飲もう"})

        bedrock_kwargs = scripted.created[1].kwargs
        assert isinstance(bedrock_kwargs["system_prompt"], str)
        assert "retry_strategy" not in bedrock_kwargs

    def test_やり直す側には失敗した側の書きかけの履歴を混ぜない(self, scripted, memory_with_history):
        scripted.scripts = {
            "anthropic": [status_error(500, "internal")],
            "bedrock": ["はい"],
        }

        invoke({"prompt": "もう少しリッチなのがいい"})

        anthropic_messages, bedrock_messages = (agent.kwargs["messages"] for agent in scripted.created)
        # 各 Agent は自分の写しに書き足した 1 件だけが増えている
        assert len(anthropic_messages) == len(bedrock_messages) == 3

    def test_途中まで返した後の失敗はやり直さない(self, scripted, caplog):
        scripted.scripts = {
            "anthropic": ["燗酒が", status_error(500, "internal")],
            "bedrock": ["二重に届いてしまう答え"],
        }

        with pytest.raises(anthropic.InternalServerError):
            invoke({"prompt": "今夜は何を飲もう"})

        assert [agent.provider for agent in scripted.created] == ["anthropic"]
        assert fallback_logs(caplog) == []

    def test_頼み方の誤りはBedrockに回さない(self, scripted):
        scripted.scripts = {
            "anthropic": [status_error(400, "messages.0: invalid content")],
            "bedrock": ["はい"],
        }

        with pytest.raises(anthropic.BadRequestError):
            invoke({"prompt": "今夜は何を飲もう"})

        assert [agent.provider for agent in scripted.created] == ["anthropic"]

    def test_Bedrockも失敗したらそのまま上げる(self, scripted):
        scripted.scripts = {
            "anthropic": [status_error(401, "invalid token")],
            "bedrock": [RuntimeError("AccessDeniedException")],
        }

        with pytest.raises(RuntimeError, match="AccessDeniedException"):
            invoke({"prompt": "今夜は何を飲もう"})


@pytest.fixture
def memory_with_history(monkeypatch):
    from conversation_memory import ConversationMemory
    from tests.test_conversation_memory import FakeMemoryClient, turn

    client = FakeMemoryClient(records=[])
    client.events = [turn("ハイボールのおすすめある", "山崎はいかがでしょう")]
    monkeypatch.setattr(
        main, "_conversation_memory", ConversationMemory("sommelier_preference-AbCdEf1234", client)
    )
    return client


class TestUsageLog:
    def test_使ったトークン数とキャッシュの効きを残す(self, caplog):
        caplog.set_level(logging.INFO)

        class Metrics:
            accumulated_usage = {
                "inputTokens": 1200,
                "outputTokens": 80,
                "cacheReadInputTokens": 1000,
                "cacheWriteInputTokens": 0,
            }

        class Result:
            metrics = Metrics()
            stop_reason = "end_turn"

        class Model:
            def get_config(self):
                return {"model_id": "claude-haiku-5-5"}

        main._log_usage("anthropic", Model(), Result(), started=0.0)

        [message] = [r.getMessage() for r in caplog.records if r.getMessage().startswith("[llm] usage ")]
        entry = json.loads(message.split(" ", 2)[2])
        assert entry["provider"] == "anthropic"
        assert entry["model"] == "claude-haiku-5-5"
        assert entry["usage"] == {"input": 1200, "output": 80, "cacheRead": 1000, "cacheWrite": 0}


class _ScriptedModel(Model):
    """Strands の本物の Agent に渡せるモデル。決めた失敗を投げるか、決めた文を流す。"""

    def __init__(self, model_id, error=None, text=""):
        self.config = {"model_id": model_id}
        self.error = error
        self.text = text

    def update_config(self, **model_config):
        self.config.update(model_config)

    def get_config(self):
        return self.config

    async def structured_output(self, output_model, prompt, system_prompt=None, **kwargs):
        raise NotImplementedError
        yield  # pragma: no cover

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        if self.error is not None:
            raise self.error
        yield {"messageStart": {"role": "assistant"}}
        yield {"contentBlockDelta": {"delta": {"text": self.text}}}
        yield {"contentBlockStop": {}}
        yield {"messageStop": {"stopReason": "end_turn"}}
        yield {
            "metadata": {
                "usage": {"inputTokens": 10, "outputTokens": 5, "totalTokens": 15},
                "metrics": {"latencyMs": 1},
            }
        }


class Test本物のAgentを通したフォールバック:
    """代役の Agent では、Strands がモデルの失敗をどの形で上げてくるかが見えない。
    本物の Agent を通して、失敗の種類を判定できる形で届き、Bedrock へ回ることを確かめる。

    1.59 ではモデルの失敗は元の例外のまま上がってくる。イベントループには
    EventLoopException に包み直す箇所もあるので、包まれた場合は fallback_reason が剥がす
    （TestFallbackReason で見ている）。"""

    @pytest.fixture
    def real_agent(self, monkeypatch):
        monkeypatch.setattr(main, "_get_owner_sub", lambda context: OWNER_SUB)
        monkeypatch.setattr(main, "_build_tools", lambda owner_sub, search_enabled=None: [])

        def use(models):
            monkeypatch.setattr(main, "load_models", lambda: models)

        return use

    def test_クレジット切れはBedrockで答える(self, real_agent, caplog):
        caplog.set_level(logging.INFO)
        real_agent(
            [
                (
                    "anthropic",
                    _ScriptedModel(
                        "claude-haiku-5-5",
                        error=status_error(400, "Your credit balance is too low to access the Anthropic API."),
                    ),
                ),
                ("bedrock", _ScriptedModel(DEFAULT_BEDROCK_MODEL_ID, text="控えの答えです")),
            ]
        )

        chunks = invoke({"prompt": "今夜は何を飲もう"})

        assert "".join(chunks) == "控えの答えです"
        [entry] = fallback_logs(caplog)
        assert entry["errorType"] == "credit_balance"
        assert entry["status"] == 400
        usage = [r.getMessage() for r in caplog.records if r.getMessage().startswith("[llm] usage ")]
        assert len(usage) == 1
        assert json.loads(usage[0].split(" ", 2)[2])["provider"] == "bedrock"

    def test_頼み方の誤りは包まれていてもBedrockに回さない(self, real_agent):
        real_agent(
            [
                ("anthropic", _ScriptedModel("claude-haiku-5-5", error=status_error(400, "invalid content"))),
                ("bedrock", _ScriptedModel(DEFAULT_BEDROCK_MODEL_ID, text="呼ばれてはいけない")),
            ]
        )

        with pytest.raises(Exception) as raised:
            invoke({"prompt": "今夜は何を飲もう"})

        assert "invalid content" in str(raised.value)
