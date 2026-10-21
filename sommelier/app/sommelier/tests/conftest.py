"""テスト用の環境変数を、main.py の読み込みより先に用意する。

main.py（が読み込む config.py）は設定ミスを起動段階で落とす（フェイルクローズ）ため、
テーブル名と Cognito の設定が無いと import すらできない。
値は形式が通れば何でもよく、テスト中に AWS へは一切アクセスしない。

LOCAL_DEV は設定しない。config.py は LOCAL_DEV と COGNITO_* の同時設定を
拒否するので、本番と同じ「Cognito 設定あり」の側で読み込む。
"""

import os

os.environ.setdefault("AWS_REGION", "ap-northeast-1")
os.environ.setdefault("PURCHASE_TABLE_NAME", "test-purchase-records")
os.environ.setdefault("DRINKING_TABLE_NAME", "test-drinking-records")
os.environ.setdefault("COGNITO_USER_POOL_ID", "ap-northeast-1_testpool")
os.environ.setdefault("COGNITO_APP_CLIENT_ID", "testappclientid")
# 好み記憶は各テストで明示的に組み立てる。読み込み時に AWS クライアントを
# 作らせないよう、既定では未設定にしておく
os.environ.pop("MEMORY_PREFERENCE_ID", None)
# Web 検索も同じ。シークレット名が設定されていると読み込み時に
# Secrets Manager のクライアントを作ってしまう
os.environ.pop("TAVILY_API_KEY_SECRET_ID", None)
# 相談の回数の上限。config.py は名前が無いと起動を止めるので入れておく。
# 実際に数えるのは各テストで差し替える（下の fixture。AWS には行かない）
os.environ.setdefault("CHAT_QUOTA_TABLE_NAME", "test-chat-quota")

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _no_quota_calls(monkeypatch):
    """相談のたびに DynamoDB へ数えに行かないよう、既定では常に通す。"""
    import main
    from quota import QuotaResult

    monkeypatch.setattr(main, "consume_quota", lambda sub: QuotaResult.OK)
