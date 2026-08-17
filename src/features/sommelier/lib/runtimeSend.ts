import { fetchAuthSession } from 'aws-amplify/auth';
import {
  SOMMELIER_RUNTIME_ARN,
  SOMMELIER_RUNTIME_QUALIFIER,
  SOMMELIER_RUNTIME_REGION,
} from '../config';
import type { ChatImagePayload, SendToSommelier } from '../types';
import { MAX_CHAT_IMAGES } from './chatImages';
import { SommelierError, isAbortError, toSommelierError } from './errors';

/** AgentCore がセッション識別に使うヘッダー。33文字以上が必要 */
const SESSION_HEADER = 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id';

function invocationUrl(): string {
  const arn = encodeURIComponent(SOMMELIER_RUNTIME_ARN);
  return (
    `https://bedrock-agentcore.${SOMMELIER_RUNTIME_REGION}.amazonaws.com` +
    `/runtimes/${arn}/invocations?qualifier=${SOMMELIER_RUNTIME_QUALIFIER}`
  );
}

async function getAccessToken(): Promise<string> {
  let session: Awaited<ReturnType<typeof fetchAuthSession>>;
  try {
    session = await fetchAuthSession();
  } catch (err) {
    // 期限切れトークンの更新に失敗した場合もここに来る
    throw new SommelierError('auth', '認証情報を取得できませんでした', { cause: err });
  }

  const token = session.tokens?.accessToken?.toString();
  if (!token) {
    throw new SommelierError('auth', '認証トークンを取得できませんでした');
  }
  return token;
}

/**
 * SSE の1行（`data: ...`）から本文を取り出す。
 *
 * 応答は文字列チャンクが JSON エンコードされて届く。
 * エラー時はオブジェクトが入るため、その場合は例外にして呼び出し側で扱う。
 */
function parseDataLine(line: string): string | null {
  if (!line.startsWith('data:')) return null;
  const payload = line.slice('data:'.length).trim();
  if (!payload) return null;

  try {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      throw new SommelierError(
        'server',
        String((parsed as { message?: string }).message ?? 'agent error'),
      );
    }
    // 想定外の形は表示しない（内部情報を出さないため）
    return null;
  } catch (err) {
    if (err instanceof SyntaxError) {
      // Runtime は必ず JSON エンコードされた文字列を返すため、
      // そうでない行は表示せず捨てる（内部情報を画面に出さない）
      console.warn('解釈できない応答行を無視しました');
      return null;
    }
    throw err;
  }
}

/**
 * デプロイ済みのソムリエ Runtime を呼び出し、応答を逐次返す。
 *
 * Cognito のアクセストークンを Bearer で送る。Runtime 側は
 * JWT Authorizer とアプリ内の JWKS 検証の二段で認証している。
 *
 * 会話の文脈は送らない。エージェントがセッション ID をたよりに
 * 自分の記憶（AgentCore Memory）から読み戻すため、こちらは
 * どの会話の続きかだけを伝えればよい。
 */
export const runtimeSend: SendToSommelier = async function* (
  prompt,
  { signal, sessionId, images },
) {
  const token = await getAccessToken();

  const body: {
    prompt: string;
    images?: ChatImagePayload[];
  } = { prompt };
  if (images && images.length > 0) {
    // ペイロードに必要なキーだけ載せる（プレビュー用 dataURL 等を送らない）
    body.images = images
      .slice(0, MAX_CHAT_IMAGES)
      .map(({ format, data }) => ({ format, data }));
  }

  let response: Response;
  try {
    response = await fetch(invocationUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        [SESSION_HEADER]: sessionId,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // 中断はそのまま伝える。呼び出し側が失敗と区別できるようにする
    if (isAbortError(err)) throw err;
    throw toSommelierError(err);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new SommelierError('auth', '認証に失敗しました', { status: response.status });
    }
    throw new SommelierError('server', 'ソムリエの呼び出しに失敗しました', {
      status: response.status,
    });
  }
  if (!response.body) {
    throw new SommelierError('server', '応答を受信できませんでした');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        // 受信途中で切れた場合。中断はそのまま伝える
        if (isAbortError(err)) throw err;
        throw new SommelierError('network', '応答の受信が中断されました', { cause: err });
      }
      const { done, value } = chunk;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // 最後の要素は行の途中の可能性があるため次のチャンクへ持ち越す
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const text = parseDataLine(line);
        if (text !== null) yield text;
      }
    }

    const rest = parseDataLine(buffer);
    if (rest !== null) yield rest;
  } finally {
    // 中断時にストリームを開いたままにしない
    await reader.cancel().catch(() => {});
  }
};
