"""相談の回数の上限（quota.py）と、上限に達したときの invoke の振る舞い。"""

import asyncio
import logging
from datetime import datetime

import pytest
from botocore.exceptions import ClientError

import main
import quota
from quota import JST, QuotaResult


class FakeDynamo:
    """条件付き UpdateItem を、件数を数えるだけの辞書で真似る。"""

    def __init__(self, fail_with=None):
        self.counts = {}
        self.calls = []
        self.fail_with = fail_with

    def update_item(self, **kwargs):
        self.calls.append(kwargs)
        if self.fail_with:
            raise self.fail_with
        key = (kwargs["Key"]["userKey"]["S"], kwargs["Key"]["day"]["S"])
        limit = int(kwargs["ExpressionAttributeValues"][":limit"]["N"])
        if self.counts.get(key, 0) >= limit:
            raise ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "UpdateItem")
        self.counts[key] = self.counts.get(key, 0) + 1


@pytest.fixture
def table(monkeypatch):
    fake = FakeDynamo()
    monkeypatch.setenv("CHAT_QUOTA_TABLE_NAME", "test-quota")
    monkeypatch.setenv("CHAT_DAILY_LIMIT", "3")
    monkeypatch.setattr(quota, "_ddb", fake)
    return fake


def test_上限までは通し_上限で断る(table):
    now = datetime(2026, 10, 11, 12, 0, tzinfo=JST)
    assert [quota.consume("user-1", now) for _ in range(3)] == [QuotaResult.OK] * 3
    assert quota.consume("user-1", now) is QuotaResult.EXCEEDED
    # 別のユーザーは別に数える
    assert quota.consume("user-2", now) is QuotaResult.OK


def test_日付は日本時間の0時で変わる(table):
    late = datetime(2026, 10, 11, 23, 59, tzinfo=JST)
    for _ in range(3):
        quota.consume("user-1", late)
    assert quota.consume("user-1", late) is QuotaResult.EXCEEDED
    assert quota.consume("user-1", datetime(2026, 10, 12, 0, 0, tzinfo=JST)) is QuotaResult.OK


def test_subはそのまま保存せずハッシュにする(table):
    quota.consume("user-1", datetime(2026, 10, 11, tzinfo=JST))
    key = table.calls[0]["Key"]["userKey"]["S"]
    assert "user-1" not in key
    assert len(key) == 64


def test_テーブル名の前後の空白は落として使う(table, monkeypatch):
    monkeypatch.setenv("CHAT_QUOTA_TABLE_NAME", " test-quota\n")
    assert quota.consume("user-1", datetime(2026, 10, 11, tzinfo=JST)) is QuotaResult.OK
    assert table.calls[0]["TableName"] == "test-quota"


def test_数えられないときはUNAVAILABLE(monkeypatch):
    fake = FakeDynamo(fail_with=ClientError({"Error": {"Code": "ResourceNotFoundException"}}, "UpdateItem"))
    monkeypatch.setenv("CHAT_QUOTA_TABLE_NAME", "test-quota")
    monkeypatch.setattr(quota, "_ddb", fake)
    assert quota.consume("user-1") is QuotaResult.UNAVAILABLE


def test_数えられないときのログはアプリのロガーに流す(monkeypatch):
    # BedrockAgentCoreApp が handler を付けるのは "bedrock_agentcore.app" だけなので、
    # その子でないと CloudWatch に体裁の揃った形で出ない（root に流れて INFO も消える）
    fake = FakeDynamo(fail_with=ClientError({"Error": {"Code": "ResourceNotFoundException"}}, "UpdateItem"))
    monkeypatch.setenv("CHAT_QUOTA_TABLE_NAME", "test-quota")
    monkeypatch.setattr(quota, "_ddb", fake)
    captured = []
    handler = logging.Handler()
    handler.emit = captured.append
    app_logger = logging.getLogger("bedrock_agentcore.app")
    app_logger.addHandler(handler)
    try:
        quota.consume("user-1")
    finally:
        app_logger.removeHandler(handler)

    assert [r.getMessage() for r in captured] == ["利用回数を記録できませんでした"]


def test_テーブル名が無ければ数えない_手元の確認用(monkeypatch):
    monkeypatch.delenv("CHAT_QUOTA_TABLE_NAME", raising=False)
    assert quota.consume("user-1") is QuotaResult.OK


def test_手元の確認以外でテーブル名が無ければ起動を止める():
    import os
    import subprocess
    import sys

    env = {k: v for k, v in os.environ.items() if k != "CHAT_QUOTA_TABLE_NAME"}
    result = subprocess.run(
        [sys.executable, "-c", "import main"], env=env, capture_output=True, text=True, cwd=os.path.dirname(main.__file__)
    )
    assert result.returncode != 0
    assert "CHAT_QUOTA_TABLE_NAME" in result.stderr


def test_上限の既定は50回で_不正な値なら既定に戻す(monkeypatch):
    monkeypatch.delenv("CHAT_DAILY_LIMIT", raising=False)
    assert quota.daily_limit() == 50
    monkeypatch.setenv("CHAT_DAILY_LIMIT", "abc")
    assert quota.daily_limit() == 50
    monkeypatch.setenv("CHAT_DAILY_LIMIT", "0")
    assert quota.daily_limit() == 50


class FakeContext:
    session_id = "session-1"


def _invoke(payload):
    async def collect():
        return [chunk async for chunk in main.invoke(payload, FakeContext())]

    return asyncio.run(collect())


@pytest.mark.parametrize(
    ("result", "expected"),
    [
        (QuotaResult.EXCEEDED, "上限（50回）"),
        (QuotaResult.UNAVAILABLE, "ただいま相談を受け付けられません"),
    ],
)
def test_上限に達したか数えられないときはモデルを呼ばない(monkeypatch, result, expected):
    monkeypatch.setattr(main, "_get_owner_sub", lambda context: "user-1")
    monkeypatch.setattr(main, "consume_quota", lambda sub: result)
    monkeypatch.setattr(main, "daily_limit", lambda: 50)

    def no_models(**_):
        raise AssertionError("モデルを呼んではいけない")

    monkeypatch.setattr(main, "load_models", no_models)
    chunks = _invoke({"prompt": "すき焼きに合うお酒"})
    assert len(chunks) == 1
    assert expected in chunks[0]


def test_入力の誤りで断った相談は数えない(monkeypatch):
    counted = []
    monkeypatch.setattr(main, "_get_owner_sub", lambda context: "user-1")
    monkeypatch.setattr(main, "consume_quota", lambda sub: counted.append(sub) or QuotaResult.OK)
    _invoke({"prompt": "   "})
    _invoke({"prompt": "x" * (main.MAX_PROMPT_LENGTH + 1)})
    assert counted == []
