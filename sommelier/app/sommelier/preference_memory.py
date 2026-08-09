"""AgentCore Memory による好み学習（会話をまたぐ長期記憶）。

Runtime はリクエストごとにステートレスで、直近の文脈はクライアントから
送られる履歴で引き継ぐ。この「セッションを閉じたら消える文脈」とは別に、
何度も相談するうちに分かってくる好み（辛口が好き・冷やより燗が多い等）を
残すのがこのモジュールの役目。

会話を CreateEvent で記録すると、AgentCore Memory 側の USER_PREFERENCE
ストラテジが非同期に好みを抽出して記憶レコードにする。次の相談では
RetrieveMemoryRecords で相談内容に近い好みだけを引き当てて文脈に入れる。

設計方針:
- 記憶は「あると提案が良くなる」機能であり、認証のような安全境界ではない。
  取得・保存に失敗しても相談自体は成立させる（フェイルオープン）。
  失敗はログに残し、ユーザーには見せない
- ただし「他人の記憶を混ぜない」ことだけは厳格に守る。名前空間には
  actor_id（Cognito の sub）を必ず含め、想定外の文字を含む actor_id は
  そもそも扱わない。IAM 条件は名前空間のテンプレート変数を `*` に
  展開したものになるため、ユーザー単位の分離はこのアプリ側の責務になる
- 取り出した記憶は「LLM がユーザー入力から抽出した文章」であり、元をたどれば
  ユーザー入力。このモジュールは生の文字列を返すだけにして、無害化と
  <user_data> による囲みは呼び出し側（main.py）の既存経路に任せる
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
log = logging.getLogger("bedrock_agentcore.app.preference_memory")

# agentcore.json の memories[].name が "preference" のとき、CDK が
# この名前で記憶 ID を注入する（MEMORY_{NAME 大文字}_ID）。
# 未設定なら好み学習は無効として動く（ローカル開発や記憶の作成前）
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
# 記憶に残す発言1件あたりの文字数上限
MAX_EVENT_TEXT_LENGTH = 2000

# actorId として許可する形式。Cognito の sub は UUID なのでこれで足りる。
# API 自体は "/" や ":" も許すが、名前空間に埋め込む値なので
# 区切り文字を弾いて他人の棚を指せないようにする
_ACTOR_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
# sessionId は AgentCore の制約（先頭が英数字・以降は英数字と -_・最大100文字）に合わせる。
# クライアントから届くヘッダー由来の値なので、そのまま API に渡さない
_SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$")


def _valid_actor_id(actor_id: Optional[str]) -> Optional[str]:
    if isinstance(actor_id, str) and _ACTOR_ID_PATTERN.fullmatch(actor_id):
        return actor_id
    return None


def _valid_session_id(session_id: Optional[str]) -> Optional[str]:
    if isinstance(session_id, str) and _SESSION_ID_PATTERN.fullmatch(session_id):
        return session_id
    return None


class PreferenceMemory:
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

        好みの抽出は AgentCore Memory 側で非同期に走るため、ここでは
        会話をそのまま渡すだけでよい。
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
        # 送らない（記憶自体は actorId だけでも残せる）
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


def load_preference_memory(region_name: Optional[str] = None) -> PreferenceMemory:
    """環境変数から好み記憶を組み立てる。未設定なら無効インスタンスを返す。"""
    memory_id = os.getenv(MEMORY_ID_ENV_NAME, "").strip()
    if not memory_id:
        log.info("%s が未設定のため好み学習は無効です", MEMORY_ID_ENV_NAME)
        return PreferenceMemory("", None)
    region = region_name or os.getenv("AWS_REGION", "ap-northeast-1")
    return PreferenceMemory(memory_id, boto3.client("bedrock-agentcore", region_name=region))
