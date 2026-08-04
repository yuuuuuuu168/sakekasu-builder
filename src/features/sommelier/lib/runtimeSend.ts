import { fetchAuthSession } from 'aws-amplify/auth';
import {
  SOMMELIER_RUNTIME_ARN,
  SOMMELIER_RUNTIME_QUALIFIER,
  SOMMELIER_RUNTIME_REGION,
} from '../config';
import type { SendToSommelier } from '../types';

/** AgentCore がセッション識別に使うヘッダー。33文字以上が必要 */
const SESSION_HEADER = 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id';

let sessionId: string | null = null;

/** 会話が続く間は同じセッション ID を使い、Runtime のセッションを再利用する */
function getSessionId(): string {
  if (sessionId === null) {
    sessionId = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  }
  return sessionId;
}

/** 「新しい相談」を始めるときに呼び、Runtime 側のセッションも切り替える */
export function resetSommelierSession(): void {
  sessionId = null;
}

function invocationUrl(): string {
  const arn = encodeURIComponent(SOMMELIER_RUNTIME_ARN);
  return (
    `https://bedrock-agentcore.${SOMMELIER_RUNTIME_REGION}.amazonaws.com` +
    `/runtimes/${arn}/invocations?qualifier=${SOMMELIER_RUNTIME_QUALIFIER}`
  );
}

async function getAccessToken(): Promise<string> {
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString();
  if (!token) {
    throw new Error('認証トークンを取得できませんでした');
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
      throw new Error(String((parsed as { message?: string }).message ?? 'agent error'));
    }
    // 想定外の形は表示しない（内部情報を出さないため）
    return null;
  } catch (err) {
    if (err instanceof SyntaxError) {
      // JSON でない行はそのまま本文として扱う
      return payload;
    }
    throw err;
  }
}

/**
 * デプロイ済みのソムリエ Runtime を呼び出し、応答を逐次返す。
 *
 * Cognito のアクセストークンを Bearer で送る。Runtime 側は
 * JWT Authorizer とアプリ内の JWKS 検証の二段で認証している。
 */
export const runtimeSend: SendToSommelier = async function* (prompt, { signal }) {
  const token = await getAccessToken();

  const response = await fetch(invocationUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      [SESSION_HEADER]: getSessionId(),
    },
    body: JSON.stringify({ prompt }),
    signal,
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('認証に失敗しました。ログインし直してください');
    }
    throw new Error(`ソムリエの呼び出しに失敗しました (HTTP ${response.status})`);
  }
  if (!response.body) {
    throw new Error('応答を受信できませんでした');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
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
