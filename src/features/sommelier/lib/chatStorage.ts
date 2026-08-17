/**
 * 相談画面の表示キャッシュと、会話を束ねるセッション ID の保管。
 *
 * エージェントに渡る会話の文脈は AgentCore Memory 側にあり、セッション ID で
 * 引き当てる。ここに残す発言は「画面を開き直したときに前の会話が見える」ための
 * 表示用の写しで、送信内容にはならない。表示だけ復元してセッションを作り直すと
 * 画面とエージェントの記憶がずれるため、両方を同じ単位で扱う。
 */
import type { ChatMessage } from '../types';

/** 保存する発言の最大件数（古いものから捨てる） */
export const MAX_STORED_MESSAGES = 50;

/**
 * 表示キャッシュもセッション ID もユーザーごとに分けて保存する。
 * 同じ端末を別のアカウントで使ったときに、前の人の相談内容が見えないように、
 * また前の人の会話の続きにならないようにする。
 */
function storageKey(userId: string): string {
  return `sakekasu:sommelier-chat:${userId}`;
}

function sessionKey(userId: string): string {
  return `sakekasu:sommelier-session:${userId}`;
}

/**
 * セッション ID として受け付ける形式。
 * エージェント側（conversation_memory.py の _SESSION_ID_PATTERN）と揃える。
 * 端末に残った値は書き換えられうるので、読むときに必ず確かめる
 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

/** AgentCore がセッション ID に要求する最小の長さ */
const MIN_SESSION_ID_LENGTH = 33;

/** 新しい会話のセッション ID を作る（UUID 2つで 33 文字以上を満たす） */
export function createSessionId(): string {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

/** 保存済みのセッション ID を返す。無い・壊れている場合は null */
export function loadSessionId(userId: string): string | null {
  if (!userId) return null;
  try {
    const stored = localStorage.getItem(sessionKey(userId));
    if (!stored) return null;
    if (stored.length < MIN_SESSION_ID_LENGTH) return null;
    if (!SESSION_ID_PATTERN.test(stored)) return null;
    return stored;
  } catch (err) {
    console.error('相談セッションの読み込みに失敗しました:', err);
    return null;
  }
}

export function saveSessionId(userId: string, sessionId: string): void {
  if (!userId) return;
  try {
    localStorage.setItem(sessionKey(userId), sessionId);
  } catch (err) {
    // 保存できなくても会話は続く（次に開いたときに続きから話せないだけ）
    console.error('相談セッションの保存に失敗しました:', err);
  }
}

/** 会話の切り替え・サインアウト時に、続きから話さないようにする */
export function clearSessionId(userId: string): void {
  if (!userId) return;
  try {
    localStorage.removeItem(sessionKey(userId));
  } catch (err) {
    console.error('相談セッションの削除に失敗しました:', err);
  }
}

/**
 * localStorage は無効化されている場合（プライベートモード等）があるため、
 * 表示キャッシュの読み書きは失敗しても会話自体は続けられるようにする。
 */
export function loadMessages(userId: string): ChatMessage[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (m): m is ChatMessage =>
          typeof m === 'object' &&
          m !== null &&
          typeof (m as ChatMessage).id === 'string' &&
          typeof (m as ChatMessage).content === 'string' &&
          ((m as ChatMessage).role === 'user' ||
            (m as ChatMessage).role === 'assistant'),
      )
      // 受信途中の状態は復元しない（開いた直後にカーソルが残らないように）。
      // 画像の実体（dataURL）は保存していないため、枚数だけ復元する
      .map(({ id, role, content, error, imageCount }) => ({
        id,
        role,
        content,
        error,
        ...(typeof imageCount === 'number' && imageCount > 0
          ? { imageCount }
          : {}),
      }));
  } catch (err) {
    console.error('相談履歴の読み込みに失敗しました:', err);
    return [];
  }
}

export function saveMessages(userId: string, messages: ChatMessage[]): void {
  if (!userId) return;
  try {
    // 添付画像の dataURL は保存しない（数 MB になり localStorage の
    // 容量上限を食い潰すため）。復元時の表示用に枚数だけ残す
    const recent = messages
      .slice(-MAX_STORED_MESSAGES)
      .map(({ id, role, content, error, images, imageCount }) => ({
        id,
        role,
        content,
        error,
        ...(imageCount ?? images?.length
          ? { imageCount: imageCount ?? images?.length }
          : {}),
      }));
    localStorage.setItem(storageKey(userId), JSON.stringify(recent));
  } catch (err) {
    // 容量超過などで保存できなくても会話は継続させる
    console.error('相談履歴の保存に失敗しました:', err);
  }
}

export function clearMessages(userId: string): void {
  if (!userId) return;
  try {
    localStorage.removeItem(storageKey(userId));
  } catch (err) {
    console.error('相談履歴の削除に失敗しました:', err);
  }
}
