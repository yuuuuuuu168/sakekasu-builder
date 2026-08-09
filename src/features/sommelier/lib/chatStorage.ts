import type { ChatMessage } from '../types';

/** 保存する発言の最大件数（古いものから捨てる） */
export const MAX_STORED_MESSAGES = 50;

/**
 * 履歴はユーザーごとに分けて保存する。
 * 同じ端末を別のアカウントで使ったときに、前の人の相談内容が見えないようにする。
 */
function storageKey(userId: string): string {
  return `sakekasu:sommelier-chat:${userId}`;
}

/**
 * localStorage は無効化されている場合（プライベートモード等）があるため、
 * 履歴の読み書きは失敗しても会話自体は続けられるようにする。
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
