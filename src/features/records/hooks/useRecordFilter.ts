import type {
  UnifiedRecord,
  RecordTypeFilter,
  CategoryFilter,
} from '../types';

/**
 * レコードをフィルタリングする純粋関数。
 * 記録種別フィルタ、カテゴリフィルタ、酒名検索をAND条件で適用する。
 * 酒名検索は曖昧検索（各文字が順番に含まれるfuzzy match）。
 */
export function filterRecords(
  records: UnifiedRecord[],
  recordType: RecordTypeFilter,
  category: CategoryFilter,
  searchQuery: string = ''
): UnifiedRecord[] {
  const query = searchQuery.toLowerCase().trim();

  return records.filter((record) => {
    const matchesType =
      recordType === 'all' || record.type === recordType;
    const matchesCategory =
      category === 'all' || record.category === category;
    const matchesSearch =
      query === '' || fuzzyMatch(record.sakeName.toLowerCase(), query);
    return matchesType && matchesCategory && matchesSearch;
  });
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
