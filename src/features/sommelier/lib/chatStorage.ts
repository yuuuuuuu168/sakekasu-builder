/**
 * 相談画面の表示キャッシュと、会話を束ねるセッション ID の保管。
 *
 * エージェントに渡る会話の文脈は AgentCore Memory 側にあり、セッション ID で
 * 引き当てる。ここに残す発言は「画面を開き直したときに前の会話が見える」ための
 * 表示用の写しで、送信内容にはならない。表示だけ復元してセッションを作り直すと
 * 画面とエージェントの記憶がずれるため、両方を同じ単位で扱う。
 */
import type { ChatMessage } from '../types';
import { isValidSessionId } from './sessionId';

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

/** 保存済みのセッション ID を返す。無い・壊れている場合は null */
export function loadSessionId(userId: string): string | null {
  if (!userId) return null;
  try {
    // 端末に残った値は書き換えられうるので、読むときに必ず確かめる
    const stored = localStorage.getItem(sessionKey(userId));
    return isValidSessionId(stored) ? stored : null;
  } catch (err) {
    console.error('相談セッションの読み込みに失敗しました:', err);
    return null;
  }
}

export function saveSessionId(userId: string, sessionId: string): void {
  if (!userId) return;
  // 書く側でも同じ検査を通す。読む側だけで見ていると、端末に何でも置ける
  // 一方で読めるのは正しい形の値だけ、という非対称ができる。
  // その隙間は「読めてしまう形の値を仕込む」（他人に選ばせたセッションで
  // 会話させる）ことに使えるので、そもそも書かせない
  if (!isValidSessionId(sessionId)) {
    console.error('相談セッションの形式が不正なため保存しません');
    return;
  }
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
 * 「消した後に書き戻さない」ための世代番号。
 *
 * 応答の保存は受信し終えてから行うので、サインアウトや「新しい相談」で
 * 消すのと競合する。AuthContext は通信の前後で2回消しているが、通信が
 * 終わってから画面が落ちるまでのわずかな間に応答が確定すると、消したはずの
 * 会話がそこで書き戻ってしまう。
 *
 * 送信を始めた時点の番号を控えておき、保存の直前に「その後で消されたか」を
 * 見て決める。時刻ではなく単調増加の番号にするのは、同一ミリ秒内の
 * 消去と保存でも順序が決まるようにするため。
 */
let writeGeneration = 0;
const clearedGeneration = new Map<string, number>();

/**
 * 保存を始めることを宣言し、その時点の世代を返す。
 * 戻り値は保存が確定したときに saveMessages へ渡す。
 */
export function beginMessagesWrite(): number {
  return ++writeGeneration;
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

/**
 * 表示用の会話を保存する。
 *
 * writeToken に beginMessagesWrite() の戻り値を渡すと、その後で
 * clearMessages が走っていた場合は書き戻さない（サインアウトや
 * 「新しい相談」と、受信し終えた応答の保存が競合したとき用）。
 */
export function saveMessages(
  userId: string,
  messages: ChatMessage[],
  writeToken?: number,
): void {
  if (!userId) return;
  if (
    writeToken !== undefined &&
    (clearedGeneration.get(storageKey(userId)) ?? 0) > writeToken
  ) {
    return;
  }
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
  // 消したことは localStorage の成否によらず記録する。書き込めない環境
  // （プライベートモード等）でも「消す意思があった後の書き戻し」は止める
  clearedGeneration.set(storageKey(userId), ++writeGeneration);
  try {
    localStorage.removeItem(storageKey(userId));
  } catch (err) {
    console.error('相談履歴の削除に失敗しました:', err);
  }
}
