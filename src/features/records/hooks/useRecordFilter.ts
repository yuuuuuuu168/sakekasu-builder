import type { UnifiedRecord, RecordFilters } from '../types';

/**
 * レコードをフィルタリングする純粋関数。
 * 記録種別・カテゴリ・飲みきりステータス・評価・キーワード検索をAND条件で適用する。
 */
export function filterRecords(
  records: UnifiedRecord[],
  filters: RecordFilters
): UnifiedRecord[] {
  const query = filters.searchQuery.toLowerCase().trim();

  return records.filter((record) => {
    const matchesType =
      filters.recordType === 'all' || record.type === filters.recordType;
    const matchesCategory =
      filters.category === 'all' || record.category === filters.category;
    const matchesSearch = query === '' || matchesSearchQuery(record, query);
    const matchesDrinkingStatus =
      filters.drinkingStatus === 'all' ||
      (record.type === 'purchase' && record.drinkingStatus === filters.drinkingStatus);
    const matchesRating =
      filters.rating === 'all' ||
      (record.type === 'drinking' && (record.rating ?? 0) >= filters.rating);
    return (
      matchesType &&
      matchesCategory &&
      matchesSearch &&
      matchesDrinkingStatus &&
      matchesRating
    );
  });
}

/**
 * キーワード検索の判定。酒名・店名・場所・飲み方・メモを横断して探す。
 *
 * 酒名だけは曖昧検索にする（うろ覚えや部分入力から辿れるようにするため）。
 * 店名やメモまで曖昧検索にすると、離れた位置の文字が拾われて
 * 無関係な記録が大量に混ざるので、こちらは部分一致で判定する。
 */
export function matchesSearchQuery(record: UnifiedRecord, query: string): boolean {
  if (fuzzyMatch(record.sakeName.toLowerCase(), query)) return true;

  const otherFields = [
    record.storeName,
    record.placeName,
    record.drinkingMethod,
    record.memo,
  ];
  return otherFields.some(
    (value) => value != null && value.toLowerCase().includes(query)
  );
}

/**
 * 曖昧検索: queryの各文字がtarget内に順番に出現するかチェック。
 * 例: fuzzyMatch('大吟醸 獺祭', '吟獺') → true
 */
export function fuzzyMatch(target: string, query: string): boolean {
  let ti = 0;
  for (let qi = 0; qi < query.length; qi++) {
    const found = target.indexOf(query[qi], ti);
    if (found === -1) return false;
    ti = found + 1;
  }
  return true;
}
