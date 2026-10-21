"""LLM の文脈に入れる文字列の無害化。

ユーザーの記録・プロンプト・好み・会話履歴・検索結果のどれも、
ここを通して偽の <user_data> / <web_data> 境界タグを作れなくしてから渡す。
"""

import html
import logging
import unicodedata
from typing import Optional

# conversation_memory.py と同じ理由で "bedrock_agentcore.app" の子として作る
log = logging.getLogger("bedrock_agentcore.app.sanitize")

# エンティティ展開＋NFKC 正規化を反復する最大回数
_MAX_NORMALIZE_PASSES = 10
# 正規化前に切り詰める倍率（保存値が巨大でも正規化コストを一定に保つ）
_RAW_TRUNCATE_FACTOR = 4
# 正規化が収束しない敵対的入力の表示用文字列（判定はこの文字列ではなく
# _neutralize_text() が None を返すかで行う。ユーザーが同じ文字列を
# 入力しても誤検知しないようにするため）
_UNSAFE_TEXT_PLACEHOLDER = "(表示できない値)"


def _neutralize_text(text: str) -> Optional[str]:
    """LLM 文脈に入れるユーザー文字列からタグ構成能力を除去する。

    HTML エンティティ展開（&lt; / 多重エンコードの &amp;lt; 等）→ NFKC 正規化
    （全角 ＜＞ → 半角、合字の展開等）で表記ゆれを正規形に潰してから
    山括弧を丸括弧に置換する。どの表記経由でも偽の <user_data> 境界タグを
    構成できない。NFKC は文字数を増やしうるため、呼び出し側は正規化後の
    長さで上限を判定すること。
    """
    # エンティティ展開と NFKC 正規化は互いに新しい入力を生む（NFKC が全角 ＆ を
    # & に変えてエンティティを再合成する等）ため、両者を1組にして
    # 変化がなくなるまで反復する
    converged = False
    for _ in range(_MAX_NORMALIZE_PASSES):
        normalized = unicodedata.normalize("NFKC", html.unescape(text))
        if normalized == text:
            converged = True
            break
        text = normalized

    # 上限内に収束しない入力は多重エンコードを積んだ敵対的入力とみなして破棄する。
    # 「あと1パス足す」対処ではネストを1段増やされるだけなので、
    # 収束したかどうかで判定してイタチごっこを構造的に断ち切る。
    # 判定結果は None で返す。表示用文字列との一致で判定すると、
    # ユーザーが同じ文字列（全角括弧は NFKC で半角化される）を入力しただけで
    # 敵対的とみなす誤検知が起きるため
    if not converged:
        log.warning("正規化が収束しない入力を破棄しました")
        return None

    # 収束済み = これ以上デコードされる表現は残っていない。
    # 山括弧を潰せば境界タグは構成不能。& も保険で全角化する
    return text.replace("<", "(").replace(">", ")").replace("&", "＆")


def _flatten_whitespace(text: str) -> str:
    """改行を含むあらゆる空白を半角スペース1つに畳む。

    ツール結果は JSON として渡るので改行は文字列の中に収まるが、
    システムプロンプトは地の文なので改行がそのまま構造になる。
    山括弧を潰すだけでは "\\n# 新しいルール" のような見出しを差し込まれると、
    <user_data> の囲みの中にいながら「# セキュリティ」と同じ高さの節に
    見えてしまう。1行に畳んで、箇条書きの1項目から出られないようにする。
    """
    return " ".join(text.split())
