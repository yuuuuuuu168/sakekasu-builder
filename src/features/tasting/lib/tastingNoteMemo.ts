import type { SakeCategory } from '@/features/purchase/types';

/**
 * テイスティングノートを備考（メモ）へ追記するための整形ロジック。
 *
 * 追記は「1項目 = 1行」で、行頭のラベルで見分けられる形にする。
 * 二重登録・再編集・一括追記のどれを通っても同じ行が増えないよう、
 * 判定と追記をここに集める。
 */

/** ノートを書くカテゴリ。ここに無いカテゴリでは生成もしない（ビール・ワイン等） */
export type NotableCategory = Extract<SakeCategory, 'WHISKY' | 'NIHONSHU'>;

export const TASTING_NOTE_LABEL = 'テイスティングノート';
export const RECOMMENDED_SERVING_LABEL = 'おすすめの飲み方';

/** 生成結果。知らない銘柄では両方 null で返る */
export interface TastingNote {
  tastingNote: string | null;
  recommendedServing: string | null;
}

/** ノートを付けるカテゴリか（ウイスキーと日本酒だけ） */
export function supportsTastingNote(category: SakeCategory): category is NotableCategory {
  return category === 'WHISKY' || category === 'NIHONSHU';
}

/**
 * すでにノートが書かれている備考か。
 *
 * 行頭のラベルだけで見る。中身の一致で見ると、利用者が手で直した1文字で
 * 「未記載」に戻り、登録のたびに同じ内容が積み上がる
 */
export function hasTastingNote(memo: string | null | undefined): boolean {
  if (!memo) return false;
  return memo
    .split('\n')
    .some((line) => line.trimStart().startsWith(`${TASTING_NOTE_LABEL}:`));
}

/** 追記する行を組み立てる。書くものが無ければ空配列 */
function noteLines(note: TastingNote): string[] {
  const lines: string[] = [];
  if (note.tastingNote) {
    lines.push(`${TASTING_NOTE_LABEL}: ${note.tastingNote}`);
  }
  // ノート抜きで飲み方だけ書いても、備考として意味を成さない
  if (note.tastingNote && note.recommendedServing) {
    lines.push(`${RECOMMENDED_SERVING_LABEL}: ${note.recommendedServing}`);
  }
  return lines;
}

/**
 * 備考へノートを追記する。
 *
 * - 既存の入力は消さず、後ろに足す（OCR の産地・度数の追記と同じ扱い）
 * - すでにノートの行があるときは何もしない
 * - 書くものが無いときも何もしない
 */
export function appendTastingNoteToMemo(memo: string, note: TastingNote): string {
  if (hasTastingNote(memo)) {
    return memo;
  }
  const lines = noteLines(note);
  if (lines.length === 0) {
    return memo;
  }
  const appended = lines.join('\n');
  return memo.trim() ? `${memo}\n${appended}` : appended;
}
