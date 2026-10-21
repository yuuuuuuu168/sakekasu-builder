"""パーソナル酒ソムリエ AgentCore Runtime エントリポイント。

ユーザーの購入記録・飲酒記録（DynamoDB）を参照して、
状況に合わせた「今何を飲むべきか」の相談に答える。
飲酒記録の評価（rating）や感想メモは、ユーザーの好みを推測する材料になる。
在庫相談のほか、料理に合わせたペアリング相談・高評価銘柄からの
レコメンド・お酒の知識の Q&A も同じチャットで受ける。
酒屋の棚や飲食店のメニューの写真（base64 添付）から、写っている銘柄と
好みを照らしたおすすめ提案もできる。

会話の続きも、会話をまたぐ好みも AgentCore Memory に残す
（conversation_memory.py）。履歴はクライアントから受け取らず、
同じセッションの記憶から読み戻す。記憶が無くても相談は成立する。

記録の外にある話（新酒の発売・蔵元の情報・相場）は Tavily の Web 検索で
引く（web_search.py）。検索が使えなくても相談は成立する。

認証はフェイルクローズ設計:
- Cognito JWKS による JWT 署名・有効期限・発行者のアプリ内検証（Authorizer 未設定でも安全）
- 検証済み sub が得られない場合は Bedrock 呼び出し前に拒否
- ローカル開発のなりすまし用 LOCAL_DEV_OWNER_SUB は LOCAL_DEV=1 の時のみ有効

このファイルは相談の受け口（invoke）だけを持ち、部品は次のモジュールに分けている。
AgentCore が起動するのは agentcore.json の entrypoint にある main.py なので、
app オブジェクトと invoke はここから動かさない。
- config.py: 環境変数と起動時の検証
- auth.py: トークンの検証と sub の取り出し（JWKS の取得とキャッシュ）
- sanitize.py: LLM の文脈に入れる文字列の無害化
- prompt.py: システムプロンプトと、日付・検索・好みの節
- records.py: 購入記録・飲酒記録の読み出しと整形
- tools.py: モデルに渡すツール（記録の読み出しと Web 検索）
- images.py: 添付画像の検証
"""

import asyncio
import copy
import json
import time
from typing import Optional

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent

# Web 検索の設定は呼び出しのたびに tools から引く（テストで代役に差し替えるため）
import tools as agent_tools
from auth import _get_owner_sub
from conversation_memory import (
    MAX_EVENT_TEXT_LENGTH,
    MAX_HISTORY_MESSAGES,
    load_conversation_memory,
)
from images import _DEFAULT_IMAGE_PROMPT, _build_image_blocks
from model.load import fallback_reason, load_models, root_error
from prompt import _build_system_prompt, _build_system_prompt_blocks
from quota import QuotaResult, consume as consume_quota, daily_limit
from sanitize import _neutralize_text
from tools import _build_tools

app = BedrockAgentCoreApp()
log = app.logger


# 悪用時のコスト増幅・リソース枯渇を抑える上限
MAX_PROMPT_LENGTH = 4000
# 過去の発言1件あたりの文字数上限。記憶に残すときの上限
# （MAX_EVENT_TEXT_LENGTH）と揃える。読み戻した文字列は無害化で
# 伸びうるため、切り詰めは読み出し側でも行う
MAX_HISTORY_MESSAGE_LENGTH = MAX_EVENT_TEXT_LENGTH


# 会話の続きと、会話をまたぐ好みの記憶。未設定なら無効インスタンスとして振る舞う
_conversation_memory = load_conversation_memory()


def _build_history(raw) -> list:
    """記憶から読み戻した会話履歴を Agent に渡せる形へ整える。

    履歴の出どころは AgentCore Memory（同じセッションの過去のイベント）で、
    書き込む時点で無害化済み。それでも読み出し側でもう一度同じ無害化を通す。
    記憶に入るのはユーザーの発話と、そこから誘導された応答であり、
    元をたどればユーザー入力だからで、記録・好みと同じ扱いにしている。
    件数と長さの上限も課す（コスト増幅と注入の両方を抑えるため）。
    role が user/assistant 以外のものや、無害化で破棄されたものは落とす。
    """
    if not isinstance(raw, list):
        return []

    messages = []
    for item in raw[-MAX_HISTORY_MESSAGES:]:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role not in ("user", "assistant") or not isinstance(content, str):
            continue

        text = _neutralize_text(content[:MAX_HISTORY_MESSAGE_LENGTH])
        if not text or not text.strip():
            continue
        # NFKC 正規化・エンティティ展開は文字数を増やしうる（合字 U+FDFA が
        # 18 文字に展開される等）ため、prompt と同様に展開後の長さでも制限する。
        # 破棄ではなく切り詰めにするのは、会話の連続性を保つため
        text = text[:MAX_HISTORY_MESSAGE_LENGTH]

        messages.append({"role": role, "content": [{"text": text}]})

    # 先頭が assistant だとモデルが会話の始まりとして扱えないため落とす
    while messages and messages[0]["role"] != "user":
        messages.pop(0)
    # 末尾も assistant で終える。直後に今回の発言（user）が続くため、
    # user が連続するとモデルが受け付けない
    while messages and messages[-1]["role"] != "assistant":
        messages.pop()
    return messages


def _model_id(model) -> Optional[str]:
    """ログに出すモデル ID。Strands のモデルなら get_config で取れる"""
    try:
        return model.get_config().get("model_id")
    except Exception:
        return None


def _log_usage(provider: str, model, result, started: float) -> None:
    """1 回の相談で使ったトークン数を 1 行の JSON で残す。

    CloudWatch Logs Insights で呼び先ごとのトークン数・キャッシュの効き・時間を集計するため。
    相談の中身と応答は出さない。数字が取れなければ何も出さない（相談には影響させない）
    """
    try:
        usage = result.metrics.accumulated_usage
        entry = {
            "feature": "sommelier",
            "provider": provider,
            "model": _model_id(model),
            "ms": int((time.monotonic() - started) * 1000),
            "stopReason": str(getattr(result, "stop_reason", None)),
            "usage": {
                "input": usage.get("inputTokens", 0),
                "output": usage.get("outputTokens", 0),
                "cacheRead": usage.get("cacheReadInputTokens", 0),
                "cacheWrite": usage.get("cacheWriteInputTokens", 0),
            },
        }
    except Exception:
        return
    log.info("[llm] usage %s", json.dumps(entry, ensure_ascii=False))


def _log_fallback(provider: str, reason: str, error: BaseException) -> None:
    """Claude API から Bedrock へ回したことを残す。

    文言は OCR・テイスティングノート（infra/lambda/shared/llm.ts）と揃える。CloudWatch Logs の
    メトリクスフィルタで「[llm] fallback」を数えられるよう、fallback=true を含む 1 行の JSON にする
    """
    error = root_error(error)
    status = getattr(error, "status_code", None)
    log.warning(
        "[llm] fallback %s",
        json.dumps(
            {
                "fallback": True,
                "feature": "sommelier",
                "from": provider,
                "to": "bedrock",
                "errorType": reason,
                "status": status if isinstance(status, int) else None,
                # 本文が長いエラーもあるので切る。相談の中身は SDK のエラーには入らない
                "message": str(error)[:300],
            },
            ensure_ascii=False,
        ),
    )


@app.entrypoint
async def invoke(payload, context):
    log.info("Invoking sommelier agent")

    # 認証ガード: 検証済み sub がなければ Bedrock を呼ばずに終了（フェイルクローズ）
    # JWKS 取得は同期 HTTP を含みうるため、別スレッドに逃がして
    # イベントループ（＝他の同時リクエスト）を止めない
    owner_sub = await asyncio.to_thread(_get_owner_sub, context)
    if not owner_sub:
        log.warning("認証されていないリクエストを拒否しました")
        yield "認証情報を確認できませんでした。ログインし直してからもう一度お試しください。"
        return

    # 添付画像（酒屋の棚・メニューの写真など）。不正があれば全体を拒否する。
    # base64 デコードは CPU バウンドなため、_get_owner_sub と同様に
    # 別スレッドへ逃がしてイベントループ（＝他の同時リクエスト）を止めない
    image_blocks, image_err = await asyncio.to_thread(
        _build_image_blocks,
        payload.get("images") if isinstance(payload, dict) else None,
    )
    if image_err:
        log.warning("不正な添付画像を拒否しました")
        yield image_err
        return

    prompt = payload.get("prompt", "") if isinstance(payload, dict) else ""
    if not isinstance(prompt, str):
        yield "相談内容を入力してください。"
        return
    if not prompt.strip():
        # 写真だけの相談は既定の文面を補う。文面も写真もなければ従来どおり拒否
        if not image_blocks:
            yield "相談内容を入力してください。"
            return
        prompt = _DEFAULT_IMAGE_PROMPT
    else:
        # 1段目: 正規化前の長さで足切り（巨大入力の正規化コスト自体を避ける）
        if len(prompt) > MAX_PROMPT_LENGTH:
            yield f"相談内容が長すぎます。{MAX_PROMPT_LENGTH}文字以内でお願いします。"
            return

        # ユーザープロンプト経由の偽 <user_data> タグ注入を遮断（ツール結果と同じ無害化）
        neutralized = _neutralize_text(prompt)

        # 無害化で破棄された（None）＝敵対的入力と判定済み。Bedrock を呼ばずに終了する
        # （記録側は該当フィールドだけ差し替えれば足りるが、プロンプト自体が
        #   敵対的なら処理を続ける理由がない）
        if neutralized is None:
            log.warning("敵対的と判定したプロンプトを拒否しました")
            yield "入力に処理できない文字列が含まれています。内容を見直してもう一度お試しください。"
            return
        prompt = neutralized

        # 2段目: NFKC 正規化やエンティティ展開は文字数を増やしうる（合字 U+FDFA が
        # 18 文字に展開される等）。Bedrock に渡すのは正規化後の文字列なので、
        # コスト増幅を防ぐため展開後の長さでも必ず判定する
        if len(prompt) > MAX_PROMPT_LENGTH:
            yield f"相談内容が長すぎます。{MAX_PROMPT_LENGTH}文字以内でお願いします。"
            return

    # モデルを呼ぶ前に、今日の相談の回数を数える（quota.py）。入力の誤りで断った相談は数えない
    quota = await asyncio.to_thread(consume_quota, owner_sub)
    if quota is QuotaResult.EXCEEDED:
        log.info("1 日の上限に達したため断りました")
        yield f"今日の相談回数の上限（{daily_limit()}回）に達しました。明日（日本時間の 0 時以降）にまたお試しください。"
        return
    if quota is QuotaResult.UNAVAILABLE:
        # 数えられないときは上限を守れないので、モデルを呼ばない（費用の上限を優先する）
        yield "ただいま相談を受け付けられません。時間をおいてもう一度お試しください。"
        return

    # ツールとシステムプロンプトは同じ判断で組み立てる。それぞれが別々に
    # 設定を読むと、「検索ツールは渡したが、検索結果を指示として扱わない
    # 注意書きは無い」組み合わせが将来生まれうる
    search_enabled = agent_tools._web_search.enabled
    tools = _build_tools(owner_sub, search_enabled=search_enabled)

    session_id = getattr(context, "session_id", None)

    # 記憶から2種類の文脈を引く。どちらも boto3 の同期呼び出しなので、
    # 他の同時リクエストを止めないよう別スレッドへ逃がし、
    # 待ち時間が積み上がらないよう同時に走らせる。
    # どちらも取得できなくても在庫と記録だけで相談は成立する
    #
    # - 直前までの会話: 同じセッションの過去のイベントから読み戻す。
    #   クライアントの自己申告を受けないので、偽のアシスタント発言を
    #   送り込む余地がない
    # - 会話をまたいで学習した好み: 今回の相談に近いものを引き当てる
    history_messages, preferences = await asyncio.gather(
        asyncio.to_thread(_conversation_memory.recent_messages, owner_sub, session_id),
        asyncio.to_thread(_conversation_memory.recall, owner_sub, prompt),
    )
    history = _build_history(history_messages)

    # 画像がある場合は Strands の content block 列として渡す
    # （BedrockModel も AnthropicModel も image ブロックをそのまま扱える）
    if image_blocks:
        agent_input = [{"text": prompt}, *image_blocks]
    else:
        agent_input = prompt

    # 記憶に残す分だけ応答を控える。上限を超えた分は捨てて、
    # 長い応答でメモリを際限なく使わないようにする
    reply_parts = []
    reply_length = 0

    # 呼び先は Claude API が先、Bedrock が控え（model/load.py）。Claude API が
    # クレジット切れ・認証・障害で失敗したら、同じ相談を Bedrock でやり直す。
    #
    # やり直すのは応答を 1 文字も返していないときだけ。途中まで返した後にやり直すと、
    # 利用者には同じ答えが二重に届く。途中で切れたものは従来どおり失敗として終える。
    # 記録を引く tool は読み取り専用なので、やり直しで 2 回呼ばれても害は無い。
    # 検索の回数の上限は tools ごとに数えているので、やり直しをまたいでも増えない
    models = load_models(on_unavailable=lambda provider, err: _log_fallback(provider, "credentials", err))
    for attempt, (provider, model) in enumerate(models):
        agent = Agent(
            model=model,
            system_prompt=(
                _build_system_prompt_blocks(preferences, search_enabled=search_enabled)
                if provider == "anthropic"
                else _build_system_prompt(preferences, search_enabled=search_enabled)
            ),
            tools=tools,
            # Agent は渡した履歴に今回のやり取りを書き足す。やり直す側に
            # 失敗した側の書きかけが混ざらないよう、毎回写しを渡す
            messages=copy.deepcopy(history),
            # Claude API では Strands の再試行（429 で最大 6 回、数分待つ）を止める。
            # 待つより Bedrock でやり直したほうが早く答えられる
            **({"retry_strategy": None} if provider == "anthropic" else {}),
        )
        started = time.monotonic()
        streamed = False
        try:
            async for event in agent.stream_async(agent_input):
                if "data" in event and isinstance(event["data"], str):
                    chunk = event["data"]
                    streamed = True
                    if reply_length < MAX_EVENT_TEXT_LENGTH:
                        reply_parts.append(chunk)
                        reply_length += len(chunk)
                    yield chunk
                elif "result" in event:
                    _log_usage(provider, model, event["result"], started)
            break
        except Exception as err:
            is_last = attempt == len(models) - 1
            reason = None if streamed or is_last else fallback_reason(err)
            if reason is None:
                raise
            _log_fallback(provider, reason, err)

    # 今回のやり取りを記憶に残す（次のリクエストで読み戻す会話履歴と、
    # 次の相談で引き当てる好みの、両方の材料になる）。
    # 応答はすでに返し終えているので、ここで失敗しても相談には影響しない。
    # 途中で中断された場合はこの行に到達せず、中途半端な会話は記録されない。
    #
    # 応答も無害化してから残す。ユーザーの発話が無害化済みでも、そこから
    # 誘導された応答の文面までは縛れない。記憶は好みの抽出を経て次回の
    # システムプロンプトに載るため、書く側でも一度潰しておく
    # （読み出し側の _build_system_prompt と二重にかける）
    reply = _neutralize_text("".join(reply_parts))
    if reply is None:
        log.warning("正規化が収束しない応答だったため記憶に残しません")
        return
    try:
        await asyncio.to_thread(
            _conversation_memory.remember,
            owner_sub,
            session_id,
            prompt,
            reply,
        )
    except Exception as err:
        log.warning("好みの記録を試みて失敗しました: %s", err)


if __name__ == "__main__":
    app.run()
