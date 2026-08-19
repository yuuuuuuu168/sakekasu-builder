/**
 * 会話を束ねるセッション ID の生成と検証。
 *
 * この値は3か所へ渡る。localStorage（端末に残す）、AgentCore Runtime の
 * セッションヘッダー、そしてエージェント側の記憶の読み書き。どこも
 * 「作った直後の値」だけを受け取るとは限らない（端末の値は書き換えられるし、
 * 関数は将来ほかの経路からも呼ばれる）ので、判定はここに1つだけ置いて、
 * 保存する時・読む時・ヘッダーに載せる時のそれぞれで通す。
 */

/**
 * セッション ID として受け付ける形式。
 * エージェント側（conversation_memory.py の _SESSION_ID_PATTERN）と揃える。
 * 改行や制御文字を弾くので、HTTP ヘッダーに載せる前の検査も兼ねる
 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

/** AgentCore がセッション ID に要求する最小の長さ */
export const MIN_SESSION_ID_LENGTH = 33;

/** 新しい会話のセッション ID を作る（UUID 2つで 33 文字以上を満たす） */
export function createSessionId(): string {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

/** AgentCore に渡せる形式かどうか。長さの下限と使える文字の両方を見る */
export function isValidSessionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= MIN_SESSION_ID_LENGTH &&
    SESSION_ID_PATTERN.test(value)
  );
}
