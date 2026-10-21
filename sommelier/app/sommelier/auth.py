"""リクエストのトークンを検証して、記録と記憶を引くための sub を取り出す。

ここで取り出した sub が、DynamoDB の owner 絞り込みと記憶の actorId の
唯一の出どころになる。検証はフェイルクローズで、取り出せなければ空文字を返し、
呼び出し側（main.py の invoke）がモデルを呼ばずに断る。
"""

import logging
import os
import threading
import time
from typing import Optional

import jwt
from jwt import PyJWKClient

from config import (
    AWS_REGION,
    COGNITO_APP_CLIENT_IDS,
    COGNITO_USER_POOL_ID,
    IS_LOCAL_DEV,
)

# conversation_memory.py と同じ理由で "bedrock_agentcore.app" の子として作る
log = logging.getLogger("bedrock_agentcore.app.auth")

# JWKS キャッシュの有効期間（秒）。期限切れ時の再取得で鍵ローテーションに追従する
_JWKS_CACHE_SECONDS = 300
# JWKS 取得の HTTP タイムアウト（秒）。ロック保持時間の上限になる
# （既定の 30 秒ではロックを長時間占有しスレッドプールを枯渇させうる）
_JWKS_FETCH_TIMEOUT = 5
# JWKS ロックの獲得待ち上限（秒）。urllib の timeout はソケット操作ごとの上限で
# TLS ハンドシェイク等で複数回発生しうるため、フェッチ上限より十分に長くとる
_JWKS_LOCK_TIMEOUT = 15
# 取得失敗後に再取得を試みないクールダウン（秒）。失敗の連鎖増幅を防ぐ
_JWKS_FAILURE_COOLDOWN = 30
# 取得失敗時に代替利用する古い鍵の最大許容経過時間（秒）
# 一時的な障害を凌ぐのが目的であり、鍵ローテーション後の受け入れ窓を
# 短く保つため 30 分に制限する
_JWKS_STALE_MAX_AGE = 30 * 60


_jwks_client: Optional[PyJWKClient] = None
# JWKS クライアントの生成とキャッシュアクセスを直列化するロック
_jwks_lock = threading.Lock()
# 直近に取得できた署名鍵と取得時刻（取得失敗時のフォールバック用）。
# 鍵と時刻を1つのタプルとして差し替えることで、ロック外から読んでも
# 「鍵と時刻がちぐはぐな組み合わせ」にならないようにする
_jwks_last_good: Optional[tuple] = None
# サーキットブレーカー: この時刻まで再取得を試みない
_jwks_retry_after = 0.0


def _cognito_issuer() -> str:
    return f"https://cognito-idp.{AWS_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}"


def _get_signing_keys():
    """JWKS 署名鍵の一覧を返す。JWKS への一切のアクセスをロックで直列化する。

    認証処理は asyncio.to_thread でワーカースレッド上を並行に走るが、
    PyJWKClient の遅延生成も内部の JWKSetCache もスレッドセーフではない。
    ロックなしでは (1) 複数スレッドが別々のクライアントを生成してキャッシュが
    分裂する、(2) 期限切れ時に全スレッドが同時フェッチする（thundering herd）、
    (3) 失敗したスレッドの put(None) が成功結果を上書きする、といった競合が起きる。
    フェッチ中は他スレッドを待たせるが、待った側は温まったキャッシュを引くため
    外向きフェッチは1回で済む。イベントループはスレッド退避により止まらない。

    待ち行列が無限に伸びないよう、二重のタイムアウトで最悪時間を有界にする:
    ロック保持時間は HTTP タイムアウト（_JWKS_FETCH_TIMEOUT）で、待ち時間は
    ロック獲得タイムアウト（_JWKS_LOCK_TIMEOUT）で上限を設ける。

    さらに Cognito 側の一時的な不調で全ユーザーが締め出されないよう、
    取得失敗時は直近の取得成功分（stale）にフォールバックする。
    PyJWT の fetch_data() は失敗時にも finally で jwk_set_cache.put(None) を
    実行してキャッシュを汚染するため、健全な鍵は本モジュール側で保持する。
    失敗直後はクールダウン中の再取得を行わず、失敗の連鎖増幅を防ぐ。
    """
    global _jwks_client, _jwks_last_good, _jwks_retry_after

    if not _jwks_lock.acquire(timeout=_JWKS_LOCK_TIMEOUT):
        # ロック競合は攻撃者が意図的に作り出せるため、この経路では stale に
        # フォールバックせず拒否する（stale を強制させる踏み台にしない）
        log.warning("JWKS ロックの獲得がタイムアウトしました")
        return []
    try:
        # クールダウン中は外向きフェッチを試みず stale で凌ぐ
        if time.monotonic() < _jwks_retry_after:
            return _stale_signing_keys()

        if _jwks_client is None:
            _jwks_client = PyJWKClient(
                f"{_cognito_issuer()}/.well-known/jwks.json",
                cache_keys=True,
                cache_jwk_set=True,
                lifespan=_JWKS_CACHE_SECONDS,
                timeout=_JWKS_FETCH_TIMEOUT,
            )
        try:
            keys = _jwks_client.get_signing_keys()
        except Exception as err:
            _jwks_retry_after = time.monotonic() + _JWKS_FAILURE_COOLDOWN
            log.error("JWKS の取得に失敗しました（stale にフォールバック）: %s", err)
            return _stale_signing_keys()

        if keys:
            _jwks_last_good = (keys, time.monotonic())
            return keys
        return _stale_signing_keys()
    finally:
        _jwks_lock.release()


def _stale_signing_keys():
    """取得失敗時に代替利用する、直近に取得できた署名鍵を返す。

    署名鍵は公開情報でローテーション頻度も低いため、Cognito 側の一時障害中に
    古い鍵で検証を続けても署名の正当性は損なわれない。ただし無期限に使うと
    ローテーション済みの鍵を受け入れ続けるため、経過時間で打ち切る。

    鍵と取得時刻はタプルで一度に読み取る。個別のグローバルを順に読むと
    読み取り途中の更新で「新しい鍵と古い時刻」の組み合わせが観測されうる。
    """
    snapshot = _jwks_last_good
    if snapshot is None:
        return []
    keys, fetched_at = snapshot
    age = time.monotonic() - fetched_at
    if age > _JWKS_STALE_MAX_AGE:
        log.error("保持している JWKS が古すぎるため使用しません（経過 %.0f 秒）", age)
        return []
    log.warning("JWKS の取得に失敗したため直近の鍵を使用します（経過 %.0f 秒）", age)
    return keys


def _find_cached_signing_key(token: str):
    """トークンの kid に一致する署名鍵を JWK セットから返す。

    PyJWKClient.get_signing_key_from_jwt() は kid が見つからないと
    refresh=True で JWKS を強制再取得するため、未知の kid を並べた
    リクエストが Cognito への外向きフェッチ増幅に使える。
    ここでは強制再取得を伴わない get_signing_keys() だけを使い、
    kid が一致しなければ再取得せずに拒否する。

    注意: get_signing_keys() はキャッシュが空または期限切れ
    （_JWKS_CACHE_SECONDS 経過）のとき、urllib による**同期 HTTP 取得**を行う。
    そのため本関数は完全なノンブロッキングではなく、呼び出し側は
    イベントループを止めないようワーカースレッドで実行すること。
    鍵ローテーションはこの期限切れ時の再取得で反映される。
    """
    kid = jwt.get_unverified_header(token).get("kid")
    if not kid:
        return None
    for key in _get_signing_keys():
        if key.key_id == kid:
            return key
    return None


def _verify_and_get_sub(token: str) -> str:
    """Cognito JWKS で署名・有効期限・発行者を検証し sub を返す。失敗時は空文字。"""
    if not COGNITO_USER_POOL_ID:
        log.error("COGNITO_USER_POOL_ID が未設定のため JWT を検証できません")
        return ""
    try:
        signing_key = _find_cached_signing_key(token)
        if signing_key is None:
            log.warning("既知の署名鍵に一致しない kid のトークンを拒否しました")
            return ""
        # verify_aud=False の理由: Cognito の access token は aud クレームを持たず、
        # id token のみが持つ。audience= を渡すと access token が常に失敗し、
        # 渡さないと aud を持つ id token が PyJWT 標準検証で常に失敗する。
        # そのため PyJWT の aud 検証は無効化し、直後の token_use 別チェックで
        # client_id（access）/ aud（id）を自前で必ず照合する。
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=_cognito_issuer(),
            options={"require": ["exp", "iss", "sub"], "verify_aud": False},
        )
    except jwt.PyJWTError as err:
        log.warning("JWT 検証に失敗: %s", err)
        return ""
    except Exception as err:  # JWKS 取得失敗など
        log.error("JWT 検証中に予期しないエラー: %s", err)
        return ""

    # audience 拘束: 同じ User Pool の別アプリクライアントのトークンを拒否する。
    # 許可するのは COGNITO_APP_CLIENT_ID に列挙したものだけ
    token_use = claims.get("token_use")
    if token_use == "access":
        if claims.get("client_id") not in COGNITO_APP_CLIENT_IDS:
            log.warning("client_id が許可一覧にありません")
            return ""
    elif token_use == "id":
        if claims.get("aud") not in COGNITO_APP_CLIENT_IDS:
            log.warning("aud が許可一覧にありません")
            return ""
    else:
        log.warning("想定外の token_use: %s", token_use)
        return ""
    return claims.get("sub") or ""


def _get_owner_sub(context) -> str:
    """検証済み JWT の sub を返す。取得できない場合は空文字（呼び出し側で拒否）。

    ローカル開発時のみ（LOCAL_DEV=1）、LOCAL_DEV_OWNER_SUB でのなりすましを許可する。
    """
    headers = getattr(context, "request_headers", None) or {}
    auth = next((v for k, v in headers.items() if k.lower() == "authorization"), "")
    scheme, _, token = auth.partition(" ")
    # RFC 6750: スキーム名は大文字小文字を区別しない
    if scheme.lower() == "bearer" and token.strip():
        sub = _verify_and_get_sub(token.strip())
        if sub:
            return sub

    if IS_LOCAL_DEV:
        return os.getenv("LOCAL_DEV_OWNER_SUB", "")
    return ""
