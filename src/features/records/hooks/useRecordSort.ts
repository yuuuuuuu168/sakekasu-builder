import type { UnifiedRecord, SortOption } from '../types';

/**
 * レコードをソートする純粋関数。
 * 元の配列を変更せず、新しいソート済み配列を返す。
 *
 * - date-desc: 日付の降順（新しい順）
 * - date-asc: 日付の昇順（古い順）
 * - price-desc: 価格の降順（高い順）、null は末尾
 * - price-asc: 価格の昇順（低い順）、null は末尾
 */
export function sortRecords(
  records: UnifiedRecord[],
  sortOption: SortOption
): UnifiedRecord[] {
  const sorted = [...records];

  switch (sortOption) {
    case 'date-desc':
      sorted.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      break;
    case 'date-asc':
      sorted.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      break;
    case 'price-desc':
      sorted.sort((a, b) => {
        if (a.price === null && b.price === null) return 0;
        if (a.price === null) return 1;
        if (b.price === null) return -1;
        return b.price - a.price;
      });
      break;
    case 'price-asc':
      sorted.sort((a, b) => {
        if (a.price === null && b.price === null) return 0;
        if (a.price === null) return 1;
        if (b.price === null) return -1;
        return a.price - b.price;
      });
      break;
    case 'rating-desc':
      sorted.sort((a, b) => {
        if (a.rating == null && b.rating == null) return 0;
        if (a.rating == null) return 1;
        if (b.rating == null) return -1;
        return b.rating - a.rating;
      });
      break;
    case 'rating-asc':
      sorted.sort((a, b) => {
        if (a.rating == null && b.rating == null) return 0;
        if (a.rating == null) return 1;
        if (b.rating == null) return -1;
        return a.rating - b.rating;
      });
      break;
  }

  return sorted;
}
