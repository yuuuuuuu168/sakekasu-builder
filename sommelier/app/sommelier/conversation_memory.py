"""AgentCore Memory によるソムリエの記憶（会話の続きと、会話をまたぐ好み）。

Runtime はリクエストごとにステートレスなので、会話の続きも好みの蓄積も
外に置かないと残らない。その置き場が AgentCore Memory で、1つの記憶
リソースが2つの役割を兼ねる。

- 短期（会話履歴）: CreateEvent で残したやり取りを、同じセッションの
  次のリクエストで ListEvents で読み戻す。クライアントに履歴を自己申告
  させないので、細工した偽のアシスタント発言を送り込む余地がない
- 長期（好み）: 同じイベントから USER_PREFERENCE ストラテジが非同期に
  好みを抽出して記憶レコードにする。次の相談では RetrieveMemoryRecords で
  相談内容に近い好みだけを引き当てて文脈に入れる

つまり書き込みは remember() の1本だけで、読み出しだけが
recent_messages()（直近の会話）と recall()（学習された好み）に分かれる。

設計方針:
- 記憶は「あると会話が続く・提案が良くなる」機能であり、認証のような
  安全境界ではない。取得・保存に失敗しても相談自体は成立させる
  （フェイルオープン）。失敗はログに残し、ユーザーには見せない
- ただし「他人の記憶を混ぜない」ことだけは厳格に守る。actor_id には
  検証済み JWT の sub を必ず使い、想定外の文字を含む値はそもそも扱わない。
  IAM で名前空間の条件を付けられるのは RetrieveMemoryRecords /
  ListMemoryRecords だけで、CreateEvent と ListEvents は actor で
  絞れない（条件キーを持たない）。ユーザー単位の分離はこのアプリ側の責務になる
- 取り出したものは、好みなら LLM がユーザー入力から抽出した文章、会話履歴なら
  ユーザーの発話とそれに誘導された応答であり、どちらも元をたどればユーザー入力。
  このモジュールは生の文字列を返すだけにして、無害化と <user_data> による
  囲みは呼び出し側（main.py）の既存経路に任せる
"""

import logging
import os
import re
from datetime import datetime, timezone
from typing import Optional

import boto3

# BedrockAgentCoreApp が handler とレベルを設定するのは "bedrock_agentcore.app"
# ロガーだけなので、その子として作って伝播で受け継ぐ。__name__ のままだと
# root に流れ、handler が無いぶん INFO が消えて体裁も揃わない
log = logging.getLogger("bedrock_agentcore.app.conversation_memory")

# agentcore.json の memories[].name が "preference" のとき、CDK が
# この名前で記憶 ID を注入する（MEMORY_{NAME 大文字}_ID）。
# 記憶リソース自体は会話履歴も兼ねるが、名前は長期記憶のストラテジに
# 由来する（改名すると CloudFormation 上のリソースが作り直しになる）。
# 未設定なら記憶は無効として動く（ローカル開発や記憶の作成前）
MEMORY_ID_ENV_NAME = "MEMORY_PREFERENCE_ID"

# 記憶の名前空間。agentcore.json の strategies[].namespaces と
# 完全に一致させること（ずれると書き込みと読み出しが別の棚を指す）
PREFERENCE_NAMESPACE_TEMPLATE = "sommelier/preference/{actorId}"

# 1回の相談で文脈に入れる好みの最大件数。多すぎるとプロンプトが膨らみ、
# その場の相談内容よりも過去の好みが強く効いてしまう
MAX_PREFERENCE_RECORDS = 5
# 好み1件あたりの文字数上限（抽出結果は JSON 文字列のことがある）
MAX_PREFERENCE_TEXT_LENGTH = 400
# 検索クエリに使う相談内容の文字数上限。API 上限は 10000 だが、
# 長文を投げても検索精度は上がらず費用だけ増えるため短く抑える
MAX_SEARCH_QUERY_LENGTH = 1000
# 記憶に残す／読み戻す発言1件あたりの文字数上限
MAX_EVENT_TEXT_LENGTH = 2000
# 文脈として読み戻す過去の発言数の上限（直近から数える）
MAX_HISTORY_MESSAGES = 10

# 会話イベントの role と、モデルに渡すときの role の対応。
# TOOL / OTHER は会話の流れではないので文脈に入れない
_ROLE_BY_EVENT_ROLE = {"USER": "user", "ASSISTANT": "assistant"}

# actorId として許可する形式。Cognito の sub は UUID なのでこれで足りる。
# API 自体は "/" や ":" も許すが、名前空間に埋め込む値なので
# 区切り文字を弾いて他人の棚を指せないようにする
_ACTOR_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
# sessionId は AgentCore の制約（先頭が英数字・以降は英数字と -_・最大100文字）に合わせる。
# クライアントから届くヘッダー由来の値なので、そのまま API に渡さない。
# 上限が 100 なのは Memory 側の制約。Runtime のセッションヘッダーは 256 まで
# 通るため、長すぎる値は「記憶に紐づけられない値」としてここで落ちる
_SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$")
# セッション ID の最小長。Runtime のセッションヘッダーが 33 文字以上を
# 要求するので、実際にはここへ短い値が届く前に弾かれている。
# それでも見るのは、フロント（sessionId.ts）と同じ下限をこちら側でも
# 持たせるため。将来 Runtime を介さない呼び出し経路が増えても、
# エントロピーの無いセッション ID で記憶を引かせない
_MIN_SESSION_ID_LENGTH = 33

# 比較のために時刻が読めないイベントへ与える値（最も古いものとして扱う）
_OLDEST_TIMESTAMP = datetime.min.replace(tzinfo=timezone.utc)


def _valid_actor_id(actor_id: Optional[str]) -> Optional[str]:
    if isinstance(actor_id, str) and _ACTOR_ID_PATTERN.fullmatch(actor_id):
        return actor_id
    return None


def _valid_session_id(session_id: Optional[str]) -> Optional[str]:
    if (
        isinstance(session_id, str)
        and len(session_id) >= _MIN_SESSION_ID_LENGTH
        and _SESSION_ID_PATTERN.fullmatch(session_id)
    ):
        return session_id
    return None


def _event_order(event) -> datetime:
    """イベントを古い順に並べるためのキー。

    ListEvents は新しい順に返すが、順序を API の振る舞いに委ねると
    仕様変更でそのまま会話が逆順になる。時刻で並べ直して自前で保証する。
    tz 付きと naive が混ざっても比較できるよう、naive は UTC とみなす
    （AgentCore が返すのは UTC。混在は起きない想定だが、比較で
    TypeError を出して履歴ごと落とさないための保険）。
    """
    if not isinstance(event, dict):
        return _OLDEST_TIMESTAMP
    timestamp = event.get("eventTimestamp")
    if not isinstance(timestamp, datetime):
        return _OLDEST_TIMESTAMP
    if timestamp.tzinfo is None:
        return timestamp.replace(tzinfo=timezone.utc)
    return timestamp


class ConversationMemory:
    """AgentCore Memory への読み書きを、失敗しても止まらない形で包む。

    memory_id が空（記憶が未設定）のときは何もしない無効インスタンスとして
    振る舞う。呼び出し側に「記憶があるか」の分岐を持たせないため。
    """

    def __init__(self, memory_id: str, client=None):
        self._memory_id = (memory_id or "").strip()
        self._client = client

    @property
    def enabled(self) -> bool:
        return bool(self._memory_id and self._client is not None)

    def _namespace(self, actor_id: str) -> str:
        """検証済みの actor_id から名前空間を組み立てる（他人の棚は指せない）。"""
        return PREFERENCE_NAMESPACE_TEMPLATE.replace("{actorId}", actor_id)

    def recent_messages(
        self,
        actor_id: str,
        session_id: Optional[str],
        limit: int = MAX_HISTORY_MESSAGES,
    ) -> list:
        """同じセッションの直近のやり取りを古い順に返す。失敗時・無効時は空リスト。

        戻り値は [{"role": "user" | "assistant", "content": "..."}] の並び。
        無害化していない生の文字列なので、LLM 文脈に入れる前に呼び出し側で
        必ず無害化を通すこと（書き込み時にも通しているが、二重にかける）。

        文脈が引けなくても、その相談単体としては成立する（フェイルオープン）。
        """
        if not self.enabled or limit <= 0:
            return []
        safe_actor = _valid_actor_id(actor_id)
        if safe_actor is None:
            log.warning("想定外の形式の actor_id のため会話履歴を参照しません")
            return []
        # セッションが分からなければ、どの会話の続きなのかも決まらない。
        # actorId だけで引くと別の相談の文脈を持ち込むことになるので引かない
        safe_session = _valid_session_id(session_id)
        if safe_session is None:
            return []

        try:
            response = self._client.list_events(
                memoryId=self._memory_id,
                actorId=safe_actor,
                sessionId=safe_session,
                includePayloads=True,
                # 1イベントに USER と ASSISTANT の2件を載せているので、
                # limit 件のイベントがあれば limit 件の発言は必ず賄える
                maxResults=limit,
            )
        except Exception as err:
            log.warning("会話履歴の取得に失敗しました（相談は続行します）: %s", err)
            return []

        events = response.get("events")
        if not isinstance(events, list):
            return []

        messages = []
        for event in sorted(events, key=_event_order):
            if not isinstance(event, dict):
                continue
            payload = event.get("payload")
            if not isinstance(payload, list):
                continue
            for entry in payload:
                if not isinstance(entry, dict):
                    continue
                conversational = entry.get("conversational")
                if not isinstance(conversational, dict):
                    continue
                role = _ROLE_BY_EVENT_ROLE.get(conversational.get("role"))
                if role is None:
                    continue
                content = conversational.get("content")
                text = content.get("text") if isinstance(content, dict) else None
                if not isinstance(text, str):
                    continue
                text = text.strip()[:MAX_EVENT_TEXT_LENGTH]
                if text:
                    messages.append({"role": role, "content": text})
        return messages[-limit:]

    def recall(self, actor_id: str, query: str) -> list:
        """相談内容に近い好みを取り出す。失敗時・無効時は空リストを返す。

        戻り値は無害化していない生の文字列。LLM 文脈に入れる前に、
        呼び出し側で必ずツール結果と同じ無害化を通すこと。
        """
        if not self.enabled:
            return []
        safe_actor = _valid_actor_id(actor_id)
        if safe_actor is None:
            log.warning("想定外の形式の actor_id のため好みを参照しません")
            return []
        search_query = (query or "").strip()[:MAX_SEARCH_QUERY_LENGTH]
        if not search_query:
            return []

        try:
            response = self._client.retrieve_memory_records(
                memoryId=self._memory_id,
                namespace=self._namespace(safe_actor),
                searchCriteria={
                    "searchQuery": search_query,
                    "topK": MAX_PREFERENCE_RECORDS,
                },
                maxResults=MAX_PREFERENCE_RECORDS,
            )
        except Exception as err:
            # 記憶が引けなくても在庫と記録だけで相談は成立する
            log.warning("好みの取得に失敗しました（相談は続行します）: %s", err)
            return []

        summaries = response.get("memoryRecordSummaries") or []
        preferences = []
        for summary in summaries[:MAX_PREFERENCE_RECORDS]:
            if not isinstance(summary, dict):
                continue
            content = summary.get("content")
            text = content.get("text") if isinstance(content, dict) else None
            if not isinstance(text, str):
                continue
            text = text.strip()[:MAX_PREFERENCE_TEXT_LENGTH]
            if text:
                preferences.append(text)
        return preferences

    def remember(
        self,
        actor_id: str,
        session_id: Optional[str],
        user_text: str,
        assistant_text: str,
    ) -> bool:
        """今回のやり取りを記憶に残す。書けたかどうかを返す（例外は投げない）。

        この1件が、次のリクエストで読み戻す会話履歴と、非同期に抽出される
        長期記憶（好み）の両方の材料になる。好みの抽出は AgentCore Memory 側で
        走るため、ここでは会話をそのまま渡すだけでよい。
        """
        if not self.enabled:
            return False
        safe_actor = _valid_actor_id(actor_id)
        if safe_actor is None:
            log.warning("想定外の形式の actor_id のため記憶に残しません")
            return False

        user_text = (user_text or "").strip()[:MAX_EVENT_TEXT_LENGTH]
        assistant_text = (assistant_text or "").strip()[:MAX_EVENT_TEXT_LENGTH]
        # 片方でも欠けたやり取り（応答前の中断など）は好みの材料にならない
        if not user_text or not assistant_text:
            return False

        params = {
            "memoryId": self._memory_id,
            "actorId": safe_actor,
            "eventTimestamp": datetime.now(timezone.utc),
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
        # セッション ID はクライアントのヘッダー由来。形式が合わないときは
        # 送らない（好みの材料としては actorId だけでも残せる。ただし
        # セッションに紐づかないぶん、会話履歴としては読み戻せない）
        safe_session = _valid_session_id(session_id)
        if safe_session:
            params["sessionId"] = safe_session

        try:
            self._client.create_event(**params)
        except Exception as err:
            # 応答はすでに返し終えている。ここで失敗しても相談には影響しない
            log.warning("好みの記録に失敗しました: %s", err)
            return False
        return True


def load_conversation_memory(region_name: Optional[str] = None) -> ConversationMemory:
    """環境変数から記憶を組み立てる。未設定なら無効インスタンスを返す。"""
    memory_id = os.getenv(MEMORY_ID_ENV_NAME, "").strip()
    if not memory_id:
        log.info("%s が未設定のため記憶は無効です", MEMORY_ID_ENV_NAME)
        return ConversationMemory("", None)
    region = region_name or os.getenv("AWS_REGION", "ap-northeast-1")
    return ConversationMemory(
        memory_id, boto3.client("bedrock-agentcore", region_name=region)
    )
