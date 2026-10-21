"""トークン検証（_verify_and_get_sub / _get_owner_sub）。

ここで取り出した sub が、DynamoDB の owner 絞り込みと記憶の actorId の
唯一の出どころになる。記憶の CreateEvent / ListEvents は IAM で actor を
絞れないので、検証が壊れると他人の記録や会話に届く。他のテストはこの関数を
差し替えて動かしているため、ここで本物の検証を通しておく。

署名鍵はテスト内で作った RSA 鍵に差し替え、JWKS は取りに行かない。
"""

import time
import types

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

import auth

SIGNING_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
FOREIGN_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
KID = "test-kid"
CLIENT_ID = "testappclientid"  # conftest.py の COGNITO_APP_CLIENT_ID
SUB = "11111111-2222-3333-4444-555555555555"


@pytest.fixture(autouse=True)
def signing_keys(monkeypatch):
    jwk = types.SimpleNamespace(key_id=KID, key=SIGNING_KEY.public_key())
    monkeypatch.setattr(auth, "_get_signing_keys", lambda: [jwk])


def claims(**overrides):
    """有効な access token のクレーム。None を渡した項目は落とす。"""
    base = {
        "sub": SUB,
        "iss": auth._cognito_issuer(),
        "exp": int(time.time()) + 300,
        "token_use": "access",
        "client_id": CLIENT_ID,
    }
    base.update(overrides)
    return {k: v for k, v in base.items() if v is not None}


def sign(payload, key=SIGNING_KEY, algorithm="RS256", kid=KID):
    return jwt.encode(payload, key, algorithm=algorithm, headers={"kid": kid})


def context_with(headers):
    return types.SimpleNamespace(request_headers=headers)


class TestVerifyAndGetSub:
    def test_正しいaccess_tokenからsubを取り出す(self):
        assert auth._verify_and_get_sub(sign(claims())) == SUB

    def test_正しいid_tokenからsubを取り出す(self):
        token = sign(claims(token_use="id", client_id=None, aud=CLIENT_ID))
        assert auth._verify_and_get_sub(token) == SUB

    @pytest.mark.parametrize(
        "token",
        [
            pytest.param(lambda: sign(claims(), key=FOREIGN_KEY), id="別の鍵で署名"),
            pytest.param(lambda: sign(claims(), kid="unknown-kid"), id="未知のkid"),
            pytest.param(lambda: sign(claims(iss="https://evil.example/pool")), id="別の発行者"),
            pytest.param(lambda: sign(claims(exp=int(time.time()) - 10)), id="期限切れ"),
            pytest.param(lambda: sign(claims(exp=None)), id="expなし"),
            pytest.param(lambda: sign(claims(sub=None)), id="subなし"),
            pytest.param(lambda: sign(claims(client_id="other-client")), id="別クライアントのaccess_token"),
            pytest.param(
                lambda: sign(claims(token_use="id", client_id=None, aud="other-client")),
                id="別クライアントのid_token",
            ),
            pytest.param(lambda: sign(claims(token_use=None)), id="token_useなし"),
            pytest.param(lambda: sign(claims(token_use="refresh")), id="想定外のtoken_use"),
            pytest.param(
                lambda: sign(claims(), key="shared-secret", algorithm="HS256"),
                id="HS256へのすり替え",
            ),
            pytest.param(lambda: sign(claims(), key=None, algorithm="none"), id="alg_none"),
            pytest.param(lambda: "not-a-jwt", id="JWTでない文字列"),
        ],
    )
    def test_不正なトークンは拒否する(self, token):
        assert auth._verify_and_get_sub(token()) == ""

    def test_署名鍵が取れなければ拒否する(self, monkeypatch):
        monkeypatch.setattr(auth, "_get_signing_keys", lambda: [])
        assert auth._verify_and_get_sub(sign(claims())) == ""


class TestGetOwnerSub:
    def test_Bearerトークンからsubを返す(self):
        context = context_with({"Authorization": f"Bearer {sign(claims())}"})
        assert auth._get_owner_sub(context) == SUB

    def test_ヘッダー名とスキーム名の大文字小文字は区別しない(self):
        context = context_with({"authorization": f"bearer {sign(claims())}"})
        assert auth._get_owner_sub(context) == SUB

    @pytest.mark.parametrize(
        "headers",
        [
            pytest.param({}, id="ヘッダーなし"),
            pytest.param({"Authorization": ""}, id="空"),
            pytest.param({"Authorization": "Bearer "}, id="トークンなし"),
            pytest.param({"Authorization": "Basic dXNlcjpwYXNz"}, id="Bearer以外"),
        ],
    )
    def test_トークンが無ければ空を返す(self, headers):
        assert auth._get_owner_sub(context_with(headers)) == ""

    def test_検証に失敗したトークンではLOCAL_DEVのsubにも落ちない(self, monkeypatch):
        # LOCAL_DEV でない限り、なりすまし用の値は読まない
        monkeypatch.setenv("LOCAL_DEV_OWNER_SUB", "spoofed-sub")
        context = context_with({"Authorization": f"Bearer {sign(claims(), key=FOREIGN_KEY)}"})
        assert auth._get_owner_sub(context) == ""

    def test_request_headersが無いcontextでも落ちない(self):
        assert auth._get_owner_sub(types.SimpleNamespace()) == ""


class Test許可するアプリクライアント:
    """COGNITO_APP_CLIENT_ID はカンマ区切りで複数指定できる（外形監視のカナリア用）。"""

    @pytest.fixture(autouse=True)
    def two_clients(self, monkeypatch):
        monkeypatch.setattr(auth, "COGNITO_APP_CLIENT_IDS", frozenset({CLIENT_ID, "canary-client"}))

    def test_列挙したどのクライアントのaccess_tokenも通す(self):
        assert auth._verify_and_get_sub(sign(claims(client_id="canary-client"))) == SUB

    def test_列挙したどのクライアントのid_tokenも通す(self):
        token = sign(claims(token_use="id", client_id=None, aud="canary-client"))
        assert auth._verify_and_get_sub(token) == SUB

    def test_列挙していないクライアントは拒否する(self):
        assert auth._verify_and_get_sub(sign(claims(client_id="other-client"))) == ""

    def test_access_tokenのaudでは通さない(self):
        # access token は client_id で照合する。aud を足しても代わりにはならない
        token = sign(claims(client_id="other-client", aud=CLIENT_ID))
        assert auth._verify_and_get_sub(token) == ""


class TestLOCAL_DEVのなりすまし:
    """LOCAL_DEV=1 の手元確認でだけ、LOCAL_DEV_OWNER_SUB を sub として使う。"""

    @pytest.fixture(autouse=True)
    def local_dev(self, monkeypatch):
        monkeypatch.setattr(auth, "IS_LOCAL_DEV", True)
        monkeypatch.setenv("LOCAL_DEV_OWNER_SUB", "local-dev-sub")

    def test_トークンが無ければなりすまし用のsubを返す(self):
        assert auth._get_owner_sub(context_with({})) == "local-dev-sub"

    def test_検証に失敗したトークンでもなりすまし用のsubに落ちる(self):
        context = context_with({"Authorization": f"Bearer {sign(claims(), key=FOREIGN_KEY)}"})
        assert auth._get_owner_sub(context) == "local-dev-sub"

    def test_検証できたトークンがあればそちらを優先する(self):
        context = context_with({"Authorization": f"Bearer {sign(claims())}"})
        assert auth._get_owner_sub(context) == SUB

    def test_なりすまし用のsubが未設定なら空を返す(self, monkeypatch):
        monkeypatch.delenv("LOCAL_DEV_OWNER_SUB")
        assert auth._get_owner_sub(context_with({})) == ""
