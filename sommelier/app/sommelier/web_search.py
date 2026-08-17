"""Tavily の検索 API を使った Web 検索（記録の外にある事実を引く口）。

購入記録・飲酒記録のツールが「ユーザーの記録の中の話」を担うのに対し、
このモジュールは記録の外の話を担う。新酒の発売・蔵元の情報・受賞歴・相場など、
モデルの学習知識ではうろ覚えになったり古くなったりする話題で、
作り話の代わりに一次情報を引けるようにするのが目的。

設計方針:
- 検索は「あると答えの確度が上がる」機能であり、安全境界ではない。
  API キーが無い・取得に失敗した・検索が失敗したのいずれでも、
  相談そのものは成立させる（フェイルソフト）。ツールはエラーを返すだけで
  例外は投げない
- 従量課金なので上限は呼び出し側の裁量に任せない。件数・検索の深さ・
  クエリ長・レスポンスサイズはこのモジュールが固定する
  （1リクエストあたりの検索回数だけは main.py がリクエスト単位で数える）
- 返すのは無害化していない生の文字列。URL だけは「そのまま出典として
  出せる形」でないと意味がないので、ここで検証してから返す。タイトルと
  本文の無害化と <web_data> による囲みは呼び出し側（main.py）に任せる
  （preference_memory.py と同じ線引き）
- API キーは Secrets Manager に置き、初回の検索で1回だけ取得して
  メモリに保持する。起動時に取ることもできるが、検索しないリクエストにまで
  コールドスタートの遅さと失敗の可能性を持ち込む理由がない
"""

import html
import json
import logging
import os
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional

import boto3

# preference_memory.py と同じ理由で "bedrock_agentcore.app" の子として作る
log = logging.getLogger("bedrock_agentcore.app.web_search")

# API キーを入れた Secrets Manager のシークレット名を渡す環境変数。
# 未設定なら Web 検索は無効として動く（ローカル開発・キー登録前）
API_KEY_SECRET_ID_ENV_NAME = "TAVILY_API_KEY_SECRET_ID"

TAVILY_SEARCH_URL = "https://api.tavily.com/search"

# 検索クエリの文字数上限。長文を投げても精度は上がらず費用だけ増える。
# ここと下の件数を変えたら、main.py の search_web の説明文も直すこと
# （モデルに見えるのはツールの説明文のほうなので、ずれると無駄な指定が増える）
MAX_QUERY_LENGTH = 200
# 1回の検索で受け取る件数。既定と上限の両方をこちら側で決め、
# モデルの指定は上限までに丸める（青天井にしない）
DEFAULT_MAX_RESULTS = 3
MAX_ALLOWED_RESULTS = 5
# 検索の深さは basic に固定する。advanced は課金単価が上がるうえ、
# 「銘柄や蔵元を調べる」用途では basic で足りる
SEARCH_DEPTH = "basic"
# 1件あたりの要約の文字数上限。外部サイトの本文がそのまま文脈に入るため、
# 長さを絞ってプロンプト全体が検索結果に埋もれないようにする
MAX_SNIPPET_LENGTH = 400
MAX_TITLE_LENGTH = 120
MAX_URL_LENGTH = 500
# HTTP のタイムアウト（秒）。相談の応答を待たせすぎない
HTTP_TIMEOUT = 10
# 読み込むレスポンスの上限バイト数。巨大な応答でメモリを使い切らせない
MAX_RESPONSE_BYTES = 1024 * 1024
# キー取得に失敗した後、再取得を試みないクールダウン（秒）。
# 失敗が続くときに Secrets Manager を叩き続けないための保険
_SECRET_FAILURE_COOLDOWN = 60

# シークレットを JSON で登録した場合に API キーとみなすキー名。
# 平文の文字列で登録されていればそのまま使う
_SECRET_JSON_KEYS = ("apiKey", "api_key", "TAVILY_API_KEY", "tavilyApiKey")

# API キーとして通す文字。HTTP ヘッダーに載せるため、改行や空白が
# 混ざった値をそのまま渡すとヘッダー分割の材料になる
_API_KEY_ALLOWED = frozenset(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_."
)

# URL としてそのまま残す文字（RFC 3986 で URL に現れうるもの）。
# ここに無い文字（非 ASCII・空白・山括弧・引用符）は percent-encode される
_URL_SAFE_CHARS = ":/?#[]@!$&()*+,;=-._~%"


def _safe_url(value) -> Optional[str]:
    """出典として出せる URL だけを通す。通せないものは None。

    URL は出典として本文にそのまま出す前提なので、他の文字列と違って
    山括弧を丸括弧に潰す無害化は通せない（潰した URL はもう開けない）。
    代わりに「http(s) であること」「タグを構成しうる文字が残らないこと」を
    確かめる方向で守る。
    """
    if not isinstance(value, str):
        return None
    url = value.strip()
    if not url or len(url) > MAX_URL_LENGTH:
        return None

    # 非 ASCII や空白、山括弧・引用符は percent-encode して ASCII に寄せる。
    # これで <web_data> の囲みを URL から抜け出す形では書けなくなる
    encoded = urllib.parse.quote(url, safe=_URL_SAFE_CHARS)
    if len(encoded) > MAX_URL_LENGTH:
        return None

    parsed = urllib.parse.urlsplit(encoded)
    # javascript: や data: を弾く。出典として出す以上、開ける先は Web だけでよい
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None

    # percent-encode をすり抜けて山括弧に戻る表記（&lt; や全角）が
    # 残っていないかまで見る。正当な URL がここで落ちることはない
    decoded = unicodedata.normalize("NFKC", html.unescape(encoded))
    if "<" in decoded or ">" in decoded:
        return None
    return encoded


def _clean_text(value, limit: int) -> str:
    """検索結果のテキストを長さ上限まで詰める（無害化は呼び出し側）。"""
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit]


class WebSearch:
    """Tavily の検索 API を、失敗しても止まらない形で包む。

    シークレット名が空（キー未設定）のときは何もしない無効インスタンスとして
    振る舞う。呼び出し側に「検索が使えるか」の分岐を持たせないため。
    """

    def __init__(self, secret_id: str, secrets_client=None, urlopen=None):
        self._secret_id = (secret_id or "").strip()
        self._secrets_client = secrets_client
        self._urlopen = urlopen or urllib.request.urlopen
        self._api_key: Optional[str] = None
        self._lock = threading.Lock()
        # 取得失敗のクールダウン明け時刻
        self._retry_after = 0.0

    @property
    def enabled(self) -> bool:
        return bool(self._secret_id and self._secrets_client is not None)

    def _load_api_key(self) -> Optional[str]:
        """Secrets Manager から API キーを1回だけ取得して保持する。"""
        if self._api_key:
            return self._api_key
        with self._lock:
            # ロック待ちの間に他のスレッドが取得を終えていることがある
            if self._api_key:
                return self._api_key
            if time.monotonic() < self._retry_after:
                return None
            try:
                response = self._secrets_client.get_secret_value(
                    SecretId=self._secret_id
                )
            except Exception as err:
                log.warning("Tavily の API キーを取得できません: %s", err)
                self._retry_after = time.monotonic() + _SECRET_FAILURE_COOLDOWN
                return None

            api_key = _extract_api_key(response.get("SecretString"))
            if not api_key:
                log.warning(
                    "シークレット %s から API キーを読み取れません", self._secret_id
                )
                self._retry_after = time.monotonic() + _SECRET_FAILURE_COOLDOWN
                return None
            self._api_key = api_key
            return api_key

    def search(self, query: str, max_results: Optional[int] = None) -> dict:
        """Web を検索する。戻り値は {"results": [...]} か {"error": "..."}。

        results の各要素は title / url / snippet を持つ。title と snippet は
        外部サイト由来の生の文字列なので、LLM 文脈に入れる前に呼び出し側で
        必ず無害化すること。
        """
        if not self.enabled:
            return {"error": "Web 検索は利用できません（API キーが未設定です）"}

        search_query = (query or "").strip()[:MAX_QUERY_LENGTH]
        if not search_query:
            return {"error": "検索キーワードを指定してください"}

        count = DEFAULT_MAX_RESULTS
        # bool は int のサブクラスなので明示的に弾く（記録ツールの min_rating と同じ）
        if max_results is not None and not isinstance(max_results, bool):
            if isinstance(max_results, int) and max_results > 0:
                count = min(max_results, MAX_ALLOWED_RESULTS)

        api_key = self._load_api_key()
        if not api_key:
            return {"error": "Web 検索は今使えません（API キーを取得できません）"}

        body = json.dumps(
            {
                "query": search_query,
                "max_results": count,
                "search_depth": SEARCH_DEPTH,
                # 要約の生成と本文の全文取得はどちらも課金と入力量を増やす。
                # 判断はこちらのモデルにさせるので、検索結果の抜粋だけでよい
                "include_answer": False,
                "include_raw_content": False,
            }
        ).encode("utf-8")
        request = urllib.request.Request(
            TAVILY_SEARCH_URL,
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            method="POST",
        )

        try:
            with self._urlopen(request, timeout=HTTP_TIMEOUT) as response:
                payload = json.loads(
                    response.read(MAX_RESPONSE_BYTES).decode("utf-8", "replace")
                )
        except urllib.error.HTTPError as err:
            # ステータスだけ残す。本文には API キーに関する情報が載りうる
            log.warning("Tavily の検索が失敗しました: HTTP %s", err.code)
            return {"error": "Web 検索に失敗しました"}
        except Exception as err:
            log.warning("Tavily の検索が失敗しました: %s", type(err).__name__)
            return {"error": "Web 検索に失敗しました"}

        if not isinstance(payload, dict):
            return {"error": "Web 検索に失敗しました"}

        results = []
        for item in (payload.get("results") or [])[:count]:
            if not isinstance(item, dict):
                continue
            url = _safe_url(item.get("url"))
            # 出典を示せない結果は使わない。URL の無い引用は検証しようがなく、
            # 作り話と見分けが付かなくなる
            if url is None:
                continue
            results.append(
                {
                    "title": _clean_text(item.get("title"), MAX_TITLE_LENGTH),
                    "url": url,
                    "snippet": _clean_text(item.get("content"), MAX_SNIPPET_LENGTH),
                }
            )
        return {"results": results}


def _extract_api_key(secret_string) -> str:
    """シークレットの中身から API キーを取り出す。

    平文の文字列でも、{"apiKey": "..."} のような JSON でも受け付ける
    （登録の仕方を間違えたときに、原因の分からない 401 だけが残るのを避ける）。
    """
    if not isinstance(secret_string, str):
        return ""
    value = secret_string.strip()
    if not value:
        return ""
    if value.startswith("{"):
        try:
            parsed = json.loads(value)
        except ValueError:
            return ""
        if not isinstance(parsed, dict):
            return ""
        value = ""
        for key in _SECRET_JSON_KEYS:
            candidate = parsed.get(key)
            if isinstance(candidate, str) and candidate.strip():
                value = candidate.strip()
                break
    # ヘッダーに載せる値なので、改行や空白を含むものは通さない
    if not value or any(char not in _API_KEY_ALLOWED for char in value):
        return ""
    return value


def load_web_search(region_name: Optional[str] = None) -> WebSearch:
    """環境変数から Web 検索を組み立てる。未設定なら無効インスタンスを返す。"""
    secret_id = os.getenv(API_KEY_SECRET_ID_ENV_NAME, "").strip()
    if not secret_id:
        log.info("%s が未設定のため Web 検索は無効です", API_KEY_SECRET_ID_ENV_NAME)
        return WebSearch("", None)
    region = region_name or os.getenv("AWS_REGION", "ap-northeast-1")
    return WebSearch(secret_id, boto3.client("secretsmanager", region_name=region))
