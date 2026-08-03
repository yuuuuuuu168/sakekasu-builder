import type { DrinkingRecordType } from '@/types/schema';

/** 過去評価の銘柄別サマリ */
export interface PastRatingSummary {
  sakeName: string;
  avgRating: number;
  count: number;
  lastDate: string; // 最終飲酒日（YYYY-MM-DD）
}

/** 検索を開始する最小入力文字数（1文字では誤マッチが多すぎるため） */
export const MIN_QUERY_LENGTH = 2;

/**
 * 銘柄名の表記ゆれを吸収する正規化。
 * 全角/半角（NFKC）・大文字小文字・空白の有無を無視して比較する。
 */
export function normalizeSakeName(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

/**
 * 入力中の銘柄名にマッチする過去の飲酒記録を銘柄別に集計する。
 *
 * - 部分一致（記録名が入力を含む、または入力が記録名を含む）
 * - 評価つき（rating > 0）の記録のみ対象
 * - 完全一致 → 飲んだ回数 → 最終飲酒日の優先順でソートし、上位 limit 件を返す
 */
export function findPastRatings(
  records: DrinkingRecordType[],
  input: string,
  limit = 3,
): PastRatingSummary[] {
  const query = normalizeSakeName(input);
  if (query.length < MIN_QUERY_LENGTH) return [];

  // グループ化キーは正規化した名前を使う（表記ゆれで同一銘柄が分裂しないように）。
  // 表示用には最初に出現した生の銘柄名を保持する。
  const groups = new Map<string, { sakeName: string; sum: number; count: number; lastDate: string }>();
  for (const record of records) {
    if (record.rating == null || record.rating <= 0) continue;
    const name = normalizeSakeName(record.sakeName);
    if (!name.includes(query) && !query.includes(name)) continue;

    const group = groups.get(name) ?? { sakeName: record.sakeName, sum: 0, count: 0, lastDate: '' };
    group.sum += record.rating;
    group.count += 1;
    if (record.drinkingDate > group.lastDate) group.lastDate = record.drinkingDate;
    groups.set(name, group);
  }

  return [...groups.values()]
    .map((g) => ({
      sakeName: g.sakeName,
      avgRating: g.sum / g.count,
      count: g.count,
      lastDate: g.lastDate,
    }))
    .sort((a, b) => {
      const aExact = normalizeSakeName(a.sakeName) === query ? 1 : 0;
      const bExact = normalizeSakeName(b.sakeName) === query ? 1 : 0;
      return (
        bExact - aExact ||
        b.count - a.count ||
        b.lastDate.localeCompare(a.lastDate) ||
        a.sakeName.localeCompare(b.sakeName, 'ja')
      );
    })
    .slice(0, limit);
}
