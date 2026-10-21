"""モデルに渡すツール（記録の読み出しと Web 検索）。"""

import logging
import threading
from typing import Optional

from strands import tool

# テーブルは呼び出しのたびに records から引く（テストで代役に差し替えるため、
# 名前を取り込んで束縛しない）
import records
from records import (
    _DRINKING_RECORD_FIELDS,
    _PURCHASE_RECORD_FIELDS,
    _RATING_MAX,
    _RATING_MIN,
    _VALID_CATEGORIES,
    _VALID_STATUSES,
    _normalize_enum,
    _query_owner_items,
    _slim_record,
)
from sanitize import (
    _RAW_TRUNCATE_FACTOR,
    _UNSAFE_TEXT_PLACEHOLDER,
    _flatten_whitespace,
    _neutralize_text,
)
from web_search import MAX_SNIPPET_LENGTH, MAX_TITLE_LENGTH, load_web_search

# conversation_memory.py と同じ理由で "bedrock_agentcore.app" の子として作る
log = logging.getLogger("bedrock_agentcore.app.tools")

# 1回の相談で許す Web 検索の回数。検索は従量課金なので、モデルの判断で
# 何度でも呼べる状態にはしない（#82 の OCR コスト保護と同じ考え方）。
# ツールをリクエストごとに作り直しているため、上限もリクエスト単位で効く
MAX_SEARCH_CALLS_PER_REQUEST = 3


# 記録の外を引く Web 検索。API キーが未設定なら無効インスタンスとして振る舞う
_web_search = load_web_search()


def _wrap_web_data(text: str, limit: int) -> str:
    """検索結果の文字列を無害化して <web_data> で囲む。

    外部サイトの文章なので、記録より一段強く疑ってよい相手だが、
    やることは記録と同じ（山括弧を潰して境界タグを作れなくする）。
    ユーザーの記録と混同させないため、囲みだけ別のタグにしている。
    改行を畳むのは、JSON の中とはいえ節に見える構造を作らせないため。
    """
    safe = _neutralize_text(text[: limit * _RAW_TRUNCATE_FACTOR])
    if safe is None:
        body = _UNSAFE_TEXT_PLACEHOLDER
    else:
        body = _flatten_whitespace(safe)[:limit]
    return f"<web_data>{body}</web_data>"


def _slim_search_result(result: dict) -> dict:
    """検索結果1件をモデル向けの形に整える。

    URL は出典として本文にそのまま出してもらうため、山括弧を潰す無害化は
    通さない（潰した URL はもう開けない）。代わりに web_search.py 側で
    http(s) であることとタグを構成する文字が残らないことを確かめている。
    """
    return {
        "title": _wrap_web_data(result.get("title", ""), MAX_TITLE_LENGTH),
        "url": result.get("url", ""),
        "snippet": _wrap_web_data(result.get("snippet", ""), MAX_SNIPPET_LENGTH),
    }


def _build_tools(owner_sub: str, search_enabled: Optional[bool] = None) -> list:
    """owner_sub をクロージャで固定した Tool 群を生成する。

    リクエストごとに生成することで、マルチユーザー環境での sub の混線を防ぐ。
    Web 検索の回数上限も、同じくクロージャに持たせてリクエスト単位で数える。

    search_enabled を省略したときは今の設定（API キーの有無）に従う。
    呼び出し側が渡すのは、システムプロンプトと同じ判断で組み立てるため。
    """
    if search_enabled is None:
        search_enabled = _web_search.enabled

    remaining_searches = MAX_SEARCH_CALLS_PER_REQUEST
    # 検索回数の判定と減算をひとまとめにするロック。Strands は1回の応答に
    # 複数の tool_use が並んだとき、同期ツールをスレッドプールで並行に呼ぶ。
    # 判定と減算が分かれていると、どちらも上限前の値を読んで全部通ってしまう
    search_budget_lock = threading.Lock()

    @tool
    def list_my_purchase_records(
        category: Optional[str] = None,
        drinking_status: Optional[str] = None,
    ):
        """あなた（認証済みユーザー）の購入記録（在庫）一覧を取得します。

        Args:
            category: (任意) カテゴリで絞り込み。NIHONSHU / BEER / WINE / WHISKY / SHOCHU / OTHER
            drinking_status: (任意) 飲みきりステータスで絞り込み。NOT_STARTED / IN_PROGRESS / FINISHED

        Returns:
            購入記録のリスト。各項目は sakeName, storeName, price, purchaseDate,
            category, memo, drinkingStatus などを含む。手元に残っている本数は
            remainingQuantity（未設定なら quantity、飲みきりなら0本）。
        """
        if not owner_sub:
            return {"error": "認証情報（owner_sub）が取得できません"}

        category, cat_err = _normalize_enum(category, _VALID_CATEGORIES, "category")
        if cat_err:
            return {"error": cat_err}
        drinking_status, status_err = _normalize_enum(
            drinking_status, _VALID_STATUSES, "drinking_status"
        )
        if status_err:
            return {"error": status_err}

        try:
            items = _query_owner_items(records._purchase_table, owner_sub)
        except Exception as err:
            log.error("DynamoDB query failed (purchase): %s", err)
            return {"error": "購入記録の取得に失敗しました"}

        if category:
            items = [i for i in items if i.get("category") == category]
        if drinking_status:
            items = [i for i in items if i.get("drinkingStatus") == drinking_status]
        return [_slim_record(i, _PURCHASE_RECORD_FIELDS) for i in items]

    @tool
    def list_my_drinking_records(
        category: Optional[str] = None,
        min_rating: Optional[int] = None,
    ):
        """あなた（認証済みユーザー）の飲酒記録（飲んだお酒の評価・感想）一覧を取得します。

        Args:
            category: (任意) カテゴリで絞り込み。NIHONSHU / BEER / WINE / WHISKY / SHOCHU / OTHER
            min_rating: (任意) この評価以上の記録に絞り込み（1〜5）

        Returns:
            飲酒記録のリスト。各項目は sakeName, placeName, drinkingDate,
            category, drinkingMethod, rating（1〜5 の評価）, memo などを含む。
        """
        if not owner_sub:
            return {"error": "認証情報（owner_sub）が取得できません"}

        category, cat_err = _normalize_enum(category, _VALID_CATEGORIES, "category")
        if cat_err:
            return {"error": cat_err}
        if min_rating is not None:
            # bool は int のサブクラスなので明示的に弾く。
            # 受け取った値はエラー文に反射しない（_normalize_enum と同じ理由）
            if isinstance(min_rating, bool) or not isinstance(min_rating, int):
                return {"error": "min_rating は整数で指定してください"}
            if not _RATING_MIN <= min_rating <= _RATING_MAX:
                return {
                    "error": f"min_rating は {_RATING_MIN}〜{_RATING_MAX} の整数で指定してください"
                }

        try:
            items = _query_owner_items(records._drinking_table, owner_sub)
        except Exception as err:
            log.error("DynamoDB query failed (drinking): %s", err)
            return {"error": "飲酒記録の取得に失敗しました"}

        if category:
            items = [i for i in items if i.get("category") == category]
        if min_rating is not None:
            items = [i for i in items if (i.get("rating") or 0) >= min_rating]
        return [_slim_record(i, _DRINKING_RECORD_FIELDS) for i in items]

    @tool
    def search_web(query: str, max_results: Optional[int] = None):
        """お酒に関する最新情報や事実を Web 検索で調べます。

        ユーザーの記録には無い話（新酒の発売状況、蔵元の所在地や沿革、受賞歴、
        いまの相場や取り扱い店など）を確かめるときに使います。
        1回の相談で使える回数には上限があります。

        Args:
            query: 検索キーワード（日本語可。200文字まで）
            max_results: (任意) 取得件数 1〜5。既定は 3

        Returns:
            results に検索結果のリスト。各項目は title（見出し）,
            url（出典。回答にそのまま載せてよい）, snippet（要約）を持つ。
            検索できなかったときは error を返す。
        """
        nonlocal remaining_searches
        # 失敗した検索も1回として数える。数えないと、失敗し続ける状況で
        # 上限が効かなくなる（コスト保護としては失敗も呼び出しのうち）
        with search_budget_lock:
            if remaining_searches <= 0:
                return {
                    "error": (
                        f"この相談で使える検索回数（{MAX_SEARCH_CALLS_PER_REQUEST}回）を"
                        "使い切りました。これ以上は調べられません"
                    )
                }
            remaining_searches -= 1

        result = _web_search.search(query, max_results)
        if "error" in result:
            return result
        return {"results": [_slim_search_result(r) for r in result["results"]]}

    tools = [list_my_purchase_records, list_my_drinking_records]
    # API キーが未設定なら検索ツール自体を渡さない。渡したうえで毎回
    # エラーを返すより、初めから無いほうがモデルは迷わない
    if search_enabled:
        tools.append(search_web)
    return tools
