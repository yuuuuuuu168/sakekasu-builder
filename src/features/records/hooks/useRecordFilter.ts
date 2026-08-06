import type { UnifiedRecord, RecordFilters } from '../types';
import { normalizeText, toPhoneticKey } from '../lib/searchNormalize';

/**
 * レコードをフィルタリングする純粋関数。
 * 記録種別・カテゴリ・飲みきりステータス・評価・キーワード検索をAND条件で適用する。
 */
export function filterRecords(
  records: UnifiedRecord[],
  filters: RecordFilters
): UnifiedRecord[] {
  const query = filters.searchQuery.trim();

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
 *
 * さらに、表記のゆれ（あらん / アラン / ｱﾗﾝ / Allan / Arran）を吸収するため、
 * 見た目を揃えた文字列と、音に変換したキーの両方で突き合わせる。
 */
export function matchesSearchQuery(record: UnifiedRecord, query: string): boolean {
  const normalizedQuery = normalizeText(query);
  if (normalizedQuery === '') return false;

  // 見た目を揃えた比較（ひらがな・全角半角・大文字小文字の違いを無視）
  if (fuzzyMatch(normalizeText(record.sakeName), normalizedQuery)) return true;
  if (matchesOtherFields(record, normalizedQuery, normalizeText)) return true;

  // 音に変換した比較（カナと英字の綴りの違いを無視）。
  // 誤ヒットを抑えるため、こちらは曖昧検索ではなく部分一致に留める
  const phoneticQuery = toPhoneticKey(query);
  if (phoneticQuery === '') return false;
  if (toPhoneticKey(record.sakeName).includes(phoneticQuery)) return true;
  return matchesOtherFields(record, phoneticQuery, toPhoneticKey);
}

/** 酒名以外の項目を、指定した変換を通して部分一致で探す */
function matchesOtherFields(
  record: UnifiedRecord,
  query: string,
  transform: (text: string) => string,
): boolean {
  const fields = [record.storeName, record.placeName, record.drinkingMethod, record.memo];
  return fields.some((value) => value != null && transform(value).includes(query));
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
