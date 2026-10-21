"""JWKS の取得とキャッシュ（_get_signing_keys / _stale_signing_keys / _find_cached_signing_key）のテスト。

test_auth.py は署名鍵の一覧を差し替えたうえでトークンの検証を見ている。
ここで見るのは、その手前で鍵をどう手に入れるか。
- PyJWKClient は 1 回だけ作り、キャッシュの寿命とタイムアウトを渡す
- 取得に失敗したら直近の鍵（stale）で凌ぎ、クールダウン中は取りに行かない
- 古すぎる鍵と、ロックを取れなかったときは使わない（拒否する）
- 未知の kid で強制再取得をさせない

Cognito には出ない。PyJWKClient は決め打ちの結果を返す代役に差し替える。
"""

import time
import types

import jwt
import pytest

import auth

KID = "test-kid"


def jwk(kid=KID):
    return types.SimpleNamespace(key_id=kid, key=object())


class FakeJWKClient:
    """PyJWKClient の代役。作られた回数と、get_signing_keys の呼ばれた回数を残す。

    results に並べたものを呼ばれるたびに 1 つずつ返す。例外なら投げる。
    """

    instances = []
    results = []

    def __init__(self, uri, **kwargs):
        self.uri = uri
        self.kwargs = kwargs
        self.calls = 0
        FakeJWKClient.instances.append(self)

    def get_signing_keys(self):
        self.calls += 1
        result = FakeJWKClient.results.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result

    def get_signing_key_from_jwt(self, token):  # pragma: no cover - 呼ばれたら失敗
        raise AssertionError("強制再取得を伴う経路は使わない")


@pytest.fixture
def jwks(monkeypatch):
    """JWKS まわりのモジュール状態を初期化し、PyJWKClient を代役に差し替える。"""
    FakeJWKClient.instances = []
    FakeJWKClient.results = []
    monkeypatch.setattr(auth, "PyJWKClient", FakeJWKClient)
    monkeypatch.setattr(auth, "_jwks_client", None)
    monkeypatch.setattr(auth, "_jwks_last_good", None)
    monkeypatch.setattr(auth, "_jwks_retry_after", 0.0)

    def _results(*results):
        FakeJWKClient.results = list(results)
        return FakeJWKClient

    return _results


def total_fetches():
    return sum(c.calls for c in FakeJWKClient.instances)


class Test鍵の取得:
    def test_発行者のJWKSを寿命とタイムアウトつきで取りに行く(self, jwks):
        key = jwk()
        jwks([key])

        assert auth._get_signing_keys() == [key]

        (client,) = FakeJWKClient.instances
        assert client.uri == f"{auth._cognito_issuer()}/.well-known/jwks.json"
        assert client.kwargs == {
            "cache_keys": True,
            "cache_jwk_set": True,
            "lifespan": auth._JWKS_CACHE_SECONDS,
            "timeout": auth._JWKS_FETCH_TIMEOUT,
        }

    def test_クライアントは1回だけ作る(self, jwks):
        # 呼ぶたびに作るとキャッシュが分裂し、毎回 Cognito へ取りに行く
        jwks([jwk()], [jwk()])

        auth._get_signing_keys()
        auth._get_signing_keys()

        assert len(FakeJWKClient.instances) == 1
        assert total_fetches() == 2

    def test_取れた鍵は控えておく(self, jwks):
        key = jwk()
        jwks([key])

        auth._get_signing_keys()

        keys, fetched_at = auth._jwks_last_good
        assert keys == [key]
        assert fetched_at <= time.monotonic()


class Test取得の失敗:
    def test_控えが無ければ空を返す(self, jwks):
        jwks(RuntimeError("timed out"))

        assert auth._get_signing_keys() == []

    def test_控えがあればそれで凌ぐ(self, jwks):
        key = jwk()
        jwks([key], RuntimeError("timed out"))
        auth._get_signing_keys()
        # クールダウンを過ぎて次の取得が走る状況にする
        auth._jwks_retry_after = 0.0

        assert auth._get_signing_keys() == [key]

    def test_空の鍵一覧が返ったときも控えで凌ぐ(self, jwks, monkeypatch):
        key = jwk()
        jwks([])
        monkeypatch.setattr(auth, "_jwks_last_good", ([key], time.monotonic()))

        assert auth._get_signing_keys() == [key]
        # 空の一覧で控えを上書きしない
        assert auth._jwks_last_good[0] == [key]

    def test_失敗した直後は取りに行かない(self, jwks):
        # 失敗の連鎖で Cognito へのリクエストを増幅させない
        jwks(RuntimeError("timed out"), [jwk()])

        auth._get_signing_keys()
        auth._get_signing_keys()
        auth._get_signing_keys()

        assert total_fetches() == 1
        assert auth._jwks_retry_after > time.monotonic()

    def test_クールダウンを過ぎたら取り直す(self, jwks):
        key = jwk()
        jwks(RuntimeError("timed out"), [key])
        auth._get_signing_keys()

        auth._jwks_retry_after = time.monotonic() - 1

        assert auth._get_signing_keys() == [key]
        assert total_fetches() == 2

    def test_古すぎる控えは使わない(self, jwks, monkeypatch):
        # ローテーション済みの鍵を受け入れ続けないよう、経過時間で打ち切る
        jwks(RuntimeError("timed out"))
        stale_at = time.monotonic() - auth._JWKS_STALE_MAX_AGE - 1
        monkeypatch.setattr(auth, "_jwks_last_good", ([jwk()], stale_at))

        assert auth._get_signing_keys() == []

    def test_失敗してもロックは手放す(self, jwks):
        jwks(RuntimeError("timed out"))

        auth._get_signing_keys()

        assert auth._jwks_lock.acquire(blocking=False)
        auth._jwks_lock.release()


class Testロックの獲得待ち:
    def test_ロックを取れなければ控えがあっても拒否する(self, jwks, monkeypatch):
        # ロックの競合は攻撃者が作り出せるので、stale を強制させる踏み台にしない
        jwks([jwk()])
        monkeypatch.setattr(auth, "_jwks_last_good", ([jwk()], time.monotonic()))
        monkeypatch.setattr(auth, "_JWKS_LOCK_TIMEOUT", 0.01)

        assert auth._jwks_lock.acquire(blocking=False)
        try:
            assert auth._get_signing_keys() == []
        finally:
            auth._jwks_lock.release()

        assert total_fetches() == 0


class Testkidからの鍵の選択:
    def token(self, kid=KID):
        headers = {"kid": kid} if kid is not None else {}
        return jwt.encode({"sub": "x"}, "secret-for-header-only-0123456789", algorithm="HS256", headers=headers)

    def test_kidが一致する鍵を返す(self, monkeypatch):
        wanted = jwk(KID)
        monkeypatch.setattr(auth, "_get_signing_keys", lambda: [jwk("other"), wanted])

        assert auth._find_cached_signing_key(self.token()) is wanted

    def test_kidが無ければ鍵を探さない(self, monkeypatch):
        called = []
        monkeypatch.setattr(auth, "_get_signing_keys", lambda: called.append(1) or [jwk()])

        assert auth._find_cached_signing_key(self.token(kid=None)) is None
        assert called == []

    def test_未知のkidでも取り直さない(self, jwks):
        # get_signing_key_from_jwt は未知の kid で refresh=True の再取得をするため使わない
        jwks([jwk("other")])

        assert auth._find_cached_signing_key(self.token(kid="unknown")) is None
        assert total_fetches() == 1


class Test検証の失敗の扱い:
    def test_鍵の取得で予期しない例外が出ても拒否する(self, monkeypatch):
        def broken():
            raise RuntimeError("boom")

        monkeypatch.setattr(auth, "_get_signing_keys", broken)

        token = jwt.encode({"sub": "x"}, "k" * 32, algorithm="HS256", headers={"kid": KID})
        assert auth._verify_and_get_sub(token) == ""

    def test_ユーザープールが未設定なら検証せずに拒否する(self, monkeypatch):
        called = []
        monkeypatch.setattr(auth, "COGNITO_USER_POOL_ID", "")
        monkeypatch.setattr(auth, "_get_signing_keys", lambda: called.append(1) or [])

        token = jwt.encode({"sub": "x"}, "k" * 32, algorithm="HS256", headers={"kid": KID})
        assert auth._verify_and_get_sub(token) == ""
        assert called == []
