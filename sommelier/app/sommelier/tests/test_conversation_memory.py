"""記憶（AgentCore Memory）の読み書きのテスト。

ここで守りたいのは2点。
1. 他人の記憶を混ぜない（actor_id / session_id の検証と名前空間の組み立て）
2. 記憶が使えなくても相談は止まらない（フェイルオープン）
"""

from datetime import datetime, timedelta, timezone

import pytest

from conversation_memory import (
    MAX_EVENT_TEXT_LENGTH,
    MAX_HISTORY_MESSAGES,
    MAX_PREFERENCE_RECORDS,
    MAX_PREFERENCE_TEXT_LENGTH,
    MAX_SEARCH_QUERY_LENGTH,
    ConversationMemory,
    load_conversation_memory,
)

OWNER_SUB = "7a1b2c3d-4e5f-6789-abcd-ef0123456789"
SESSION_ID = "11111111-2222-3333-4444-555555555555"
MEMORY_ID = "sommelier_preference-AbCdEf1234"

BASE_TIME = datetime(2026, 8, 9, 12, 0, tzinfo=timezone.utc)


class FakeMemoryClient:
    """boto3 の bedrock-agentcore クライアントの代役。呼び出し内容を記録する。"""

    def __init__(
        self,
        records=None,
        events=None,
        retrieve_error=None,
        create_error=None,
        list_error=None,
    ):
        self.records = records if records is not None else []
        self.events = events if events is not None else []
        self.retrieve_error = retrieve_error
        self.create_error = create_error
        self.list_error = list_error
        self.retrieve_calls = []
        self.create_calls = []
        self.list_calls = []

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

    def list_events(self, **kwargs):
        self.list_calls.append(kwargs)
        if self.list_error:
            raise self.list_error
        return {"events": self.events}


def summary(text):
    return {"memoryRecordId": "rec-1", "content": {"text": text}}


def turn(user_text, assistant_text, minutes=0):
    """CreateEvent が残すのと同じ形（1イベントに USER と ASSISTANT）のイベント。"""
    return {
        "eventId": f"ev-{minutes}",
        "eventTimestamp": BASE_TIME + timedelta(minutes=minutes),
        "payload": [
            {"conversational": {"role": "USER", "content": {"text": user_text}}},
            {
                "conversational": {
                    "role": "ASSISTANT",
                    "content": {"text": assistant_text},
                }
            },
        ],
    }


def build(records=None, **kwargs):
    client = FakeMemoryClient(records=records, **kwargs)
    return ConversationMemory(MEMORY_ID, client), client


class TestRecentMessages:
    def test_同じセッションのやり取りを古い順に返す(self):
        memory, client = build(
            events=[turn("2回目の相談", "2回目の応答", 5), turn("最初の相談", "最初の応答", 0)]
        )

        assert memory.recent_messages(OWNER_SUB, SESSION_ID) == [
            {"role": "user", "content": "最初の相談"},
            {"role": "assistant", "content": "最初の応答"},
            {"role": "user", "content": "2回目の相談"},
            {"role": "assistant", "content": "2回目の応答"},
        ]
        call = client.list_calls[0]
        assert call["memoryId"] == MEMORY_ID
        assert call["actorId"] == OWNER_SUB
        assert call["sessionId"] == SESSION_ID
        assert call["includePayloads"] is True

    def test_記憶が未設定なら呼び出さずに空を返す(self):
        memory = ConversationMemory("", None)

        assert memory.recent_messages(OWNER_SUB, SESSION_ID) == []

    @pytest.mark.parametrize(
        "actor_id",
        ["", None, "../other-user", "sub:other", "a" * 200],
    )
    def test_想定外の形式のactor_idでは引かない(self, actor_id):
        memory, client = build(events=[turn("相談", "応答")])

        assert memory.recent_messages(actor_id, SESSION_ID) == []
        assert client.list_calls == []

    @pytest.mark.parametrize(
        "session_id",
        [None, "", "セッション", "-leading-hyphen", "a" * 101, "sess/../other"],
    )
    def test_形式の合わないセッションidでは引かない(self, session_id):
        # セッションが決まらないまま actorId だけで引くと、別の相談の
        # 文脈を持ち込むことになる。引かないほうが安全側
        memory, client = build(events=[turn("相談", "応答")])

        assert memory.recent_messages(OWNER_SUB, session_id) == []
        assert client.list_calls == []

    def test_取得に失敗しても例外にせず空を返す(self):
        memory, _ = build(list_error=RuntimeError("boom"))

        assert memory.recent_messages(OWNER_SUB, SESSION_ID) == []

    def test_件数上限を超える分は古いほうから捨てる(self):
        events = [turn(f"相談{i}", f"応答{i}", i) for i in range(MAX_HISTORY_MESSAGES)]
        memory, client = build(events=events)

        messages = memory.recent_messages(OWNER_SUB, SESSION_ID)

        assert len(messages) == MAX_HISTORY_MESSAGES
        # 直近のやり取りが末尾に残ること（切るのは古いほう）
        assert messages[-1] == {
            "role": "assistant",
            "content": f"応答{MAX_HISTORY_MESSAGES - 1}",
        }
        # 取りに行く件数も上限に合わせる（1イベント2発言なので必ず賄える）
        assert client.list_calls[0]["maxResults"] == MAX_HISTORY_MESSAGES

    def test_長い発言は切り詰める(self):
        memory, _ = build(events=[turn("あ" * (MAX_EVENT_TEXT_LENGTH + 100), "応答")])

        messages = memory.recent_messages(OWNER_SUB, SESSION_ID)

        assert len(messages[0]["content"]) == MAX_EVENT_TEXT_LENGTH

    def test_会話でないイベントは文脈に入れない(self):
        # TOOL / OTHER や blob のイベントは会話の流れではない
        memory, _ = build(
            events=[
                {
                    "eventTimestamp": BASE_TIME,
                    "payload": [
                        {"conversational": {"role": "TOOL", "content": {"text": "ツール結果"}}},
                        {"blob": {"data": "..."}},
                        {"conversational": {"role": "USER", "content": {"text": "相談"}}},
                    ],
                }
            ]
        )

        assert memory.recent_messages(OWNER_SUB, SESSION_ID) == [
            {"role": "user", "content": "相談"}
        ]

    @pytest.mark.parametrize(
        "events",
        [
            None,
            "文字列",
            ["文字列"],
            [{"eventTimestamp": BASE_TIME}],
            [{"eventTimestamp": BASE_TIME, "payload": "文字列"}],
            [{"eventTimestamp": BASE_TIME, "payload": [None]}],
            [{"eventTimestamp": BASE_TIME, "payload": [{"conversational": None}]}],
            [{"eventTimestamp": BASE_TIME, "payload": [{"conversational": {"role": "USER"}}]}],
            [
                {
                    "eventTimestamp": BASE_TIME,
                    "payload": [{"conversational": {"role": "USER", "content": {"text": None}}}],
                }
            ],
            [
                {
                    "eventTimestamp": BASE_TIME,
                    "payload": [{"conversational": {"role": "USER", "content": {"text": "  "}}}],
                }
            ],
        ],
    )
    def test_想定外の形の応答は落とす(self, events):
        memory, _ = build(events=events)

        assert memory.recent_messages(OWNER_SUB, SESSION_ID) == []

    def test_時刻が読めないイベントが混ざっても並びが壊れない(self):
        # 比較で TypeError を出して履歴ごと失うより、古い扱いで並べたほうがよい
        naive = {
            "eventTimestamp": BASE_TIME.replace(tzinfo=None) + timedelta(minutes=1),
            "payload": [{"conversational": {"role": "USER", "content": {"text": "naive"}}}],
        }
        missing = {
            "payload": [{"conversational": {"role": "USER", "content": {"text": "時刻なし"}}}]
        }
        memory, _ = build(events=[naive, turn("最新", "応答", 10), missing])

        contents = [m["content"] for m in memory.recent_messages(OWNER_SUB, SESSION_ID)]

        assert contents == ["時刻なし", "naive", "最新", "応答"]


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
        memory = ConversationMemory("", None)

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
        memory = ConversationMemory("", None)

        assert memory.remember(OWNER_SUB, None, "質問", "回答") is False


class TestLoad:
    def test_環境変数が無ければ無効なインスタンスになる(self, monkeypatch):
        monkeypatch.delenv("MEMORY_PREFERENCE_ID", raising=False)

        assert load_conversation_memory().enabled is False

    def test_空白だけの環境変数も未設定として扱う(self, monkeypatch):
        monkeypatch.setenv("MEMORY_PREFERENCE_ID", "   ")

        assert load_conversation_memory().enabled is False
