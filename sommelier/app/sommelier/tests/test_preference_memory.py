"""好み記憶（AgentCore Memory）の読み書きのテスト。

ここで守りたいのは2点。
1. 他人の記憶を混ぜない（actor_id の検証と名前空間の組み立て）
2. 記憶が使えなくても相談は止まらない（フェイルオープン）
"""

import pytest

from preference_memory import (
    MAX_EVENT_TEXT_LENGTH,
    MAX_PREFERENCE_RECORDS,
    MAX_PREFERENCE_TEXT_LENGTH,
    MAX_SEARCH_QUERY_LENGTH,
    PreferenceMemory,
    load_preference_memory,
)

OWNER_SUB = "7a1b2c3d-4e5f-6789-abcd-ef0123456789"
MEMORY_ID = "sommelier_preference-AbCdEf1234"


class FakeMemoryClient:
    """boto3 の bedrock-agentcore クライアントの代役。呼び出し内容を記録する。"""

    def __init__(self, records=None, retrieve_error=None, create_error=None):
        self.records = records if records is not None else []
        self.retrieve_error = retrieve_error
        self.create_error = create_error
        self.retrieve_calls = []
        self.create_calls = []

    def retrieve_memory_records(self, **kwargs):
        self.retrieve_calls.append(kwargs)
        if self.retrieve_error:
            raise self.retrieve_error
        return {"memoryRecordSummaries": self.records}

    def create_event(self, **kwargs):
        self.create_calls.append(kwargs)
        if self.create_error:
            raise self.create_error
        return {"event": {}}


def summary(text):
    return {"memoryRecordId": "rec-1", "content": {"text": text}}


def build(records=None, **kwargs):
    client = FakeMemoryClient(records=records, **kwargs)
    return PreferenceMemory(MEMORY_ID, client), client


class TestRecall:
    def test_相談内容に近い好みを本人の名前空間から引く(self):
        memory, client = build([summary("辛口の純米が好き"), summary("燗が多い")])

        assert memory.recall(OWNER_SUB, "今夜はすき焼き") == [
            "辛口の純米が好き",
            "燗が多い",
        ]
        call = client.retrieve_calls[0]
        assert call["memoryId"] == MEMORY_ID
        assert call["namespace"] == f"sommelier/preference/{OWNER_SUB}"
        assert call["searchCriteria"]["searchQuery"] == "今夜はすき焼き"

    def test_記憶が未設定なら呼び出さずに空を返す(self):
        memory = PreferenceMemory("", None)

        assert memory.enabled is False
        assert memory.recall(OWNER_SUB, "今夜はすき焼き") == []

    @pytest.mark.parametrize(
        "actor_id",
        [
            "",
            None,
            # 名前空間の区切りを含む値。素通しすると他人の棚を指せてしまう
            "../other-user",
            "sub/../../admin",
            "sub:other",
            "a" * 200,
        ],
    )
    def test_想定外の形式のactor_idでは引かない(self, actor_id):
        memory, client = build([summary("辛口の純米が好き")])

        assert memory.recall(actor_id, "今夜はすき焼き") == []
        assert client.retrieve_calls == []

    def test_相談内容が空なら引かない(self):
        memory, client = build([summary("辛口の純米が好き")])

        assert memory.recall(OWNER_SUB, "   ") == []
        assert client.retrieve_calls == []

    def test_取得に失敗しても例外にせず空を返す(self):
        memory, _ = build(retrieve_error=RuntimeError("boom"))

        assert memory.recall(OWNER_SUB, "今夜はすき焼き") == []

    def test_長すぎる検索クエリは切り詰めて投げる(self):
        memory, client = build()

        memory.recall(OWNER_SUB, "あ" * (MAX_SEARCH_QUERY_LENGTH + 500))

        query = client.retrieve_calls[0]["searchCriteria"]["searchQuery"]
        assert len(query) == MAX_SEARCH_QUERY_LENGTH

    def test_長い好みは切り詰める(self):
        memory, _ = build([summary("あ" * (MAX_PREFERENCE_TEXT_LENGTH + 100))])

        assert len(memory.recall(OWNER_SUB, "今夜はすき焼き")[0]) == (
            MAX_PREFERENCE_TEXT_LENGTH
        )

    def test_件数上限を超える応答は切り捨てる(self):
        many = [summary(f"好み{i}") for i in range(MAX_PREFERENCE_RECORDS + 5)]
        memory, _ = build(many)

        assert len(memory.recall(OWNER_SUB, "今夜はすき焼き")) == MAX_PREFERENCE_RECORDS

    @pytest.mark.parametrize(
        "record",
        [
            "文字列",
            {"memoryRecordId": "rec-1"},
            {"memoryRecordId": "rec-1", "content": None},
            {"memoryRecordId": "rec-1", "content": {"text": None}},
            {"memoryRecordId": "rec-1", "content": {"text": "   "}},
        ],
    )
    def test_想定外の形の応答は落とす(self, record):
        memory, _ = build([record])

        assert memory.recall(OWNER_SUB, "今夜はすき焼き") == []


class TestRemember:
    def test_やり取りをそのまま記憶に残す(self):
        memory, client = build()
        session_id = "11111111-2222-3333-4444-555555555555"

        assert memory.remember(OWNER_SUB, session_id, "すき焼きに合うのは？", "燗酒がおすすめです")

        call = client.create_calls[0]
        assert call["memoryId"] == MEMORY_ID
        assert call["actorId"] == OWNER_SUB
        assert call["sessionId"] == session_id
        assert call["payload"] == [
            {"conversational": {"role": "USER", "content": {"text": "すき焼きに合うのは？"}}},
            {
                "conversational": {
                    "role": "ASSISTANT",
                    "content": {"text": "燗酒がおすすめです"},
                }
            },
        ]

    @pytest.mark.parametrize(
        "session_id",
        [None, "", "セッション", "-leading-hyphen", "a" * 101],
    )
    def test_形式の合わないセッションidは付けずに残す(self, session_id):
        memory, client = build()

        assert memory.remember(OWNER_SUB, session_id, "質問", "回答")
        assert "sessionId" not in client.create_calls[0]

    @pytest.mark.parametrize(
        ("user_text", "assistant_text"),
        [("", "回答"), ("質問", ""), ("   ", "回答"), ("質問", "   ")],
    )
    def test_片側しかないやり取りは残さない(self, user_text, assistant_text):
        memory, client = build()

        assert memory.remember(OWNER_SUB, None, user_text, assistant_text) is False
        assert client.create_calls == []

    def test_想定外の形式のactor_idでは残さない(self):
        memory, client = build()

        assert memory.remember("../other-user", None, "質問", "回答") is False
        assert client.create_calls == []

    def test_長いやり取りは切り詰めて残す(self):
        memory, client = build()

        memory.remember(
            OWNER_SUB,
            None,
            "あ" * (MAX_EVENT_TEXT_LENGTH + 100),
            "い" * (MAX_EVENT_TEXT_LENGTH + 100),
        )

        payload = client.create_calls[0]["payload"]
        for message in payload:
            assert len(message["conversational"]["content"]["text"]) == MAX_EVENT_TEXT_LENGTH

    def test_保存に失敗しても例外にしない(self):
        memory, _ = build(create_error=RuntimeError("boom"))

        assert memory.remember(OWNER_SUB, None, "質問", "回答") is False

    def test_記憶が未設定なら呼び出さない(self):
        memory = PreferenceMemory("", None)

        assert memory.remember(OWNER_SUB, None, "質問", "回答") is False


class TestLoad:
    def test_環境変数が無ければ無効なインスタンスになる(self, monkeypatch):
        monkeypatch.delenv("MEMORY_PREFERENCE_ID", raising=False)

        assert load_preference_memory().enabled is False

    def test_空白だけの環境変数も未設定として扱う(self, monkeypatch):
        monkeypatch.setenv("MEMORY_PREFERENCE_ID", "   ")

        assert load_preference_memory().enabled is False
