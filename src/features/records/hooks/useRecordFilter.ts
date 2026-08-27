import type { UnifiedRecord, RecordFilters, PriceRangeFilter } from '../types';
import { PRICE_RANGE_BOUNDS } from '../types';
import { normalizeText, toPhoneticKey } from '../lib/searchNormalize';
import { resolveDateBounds } from '../lib/dateRange';

/**
 * レコードをフィルタリングする純粋関数。
 * 記録種別・カテゴリ・飲みきりステータス・評価・価格帯・日付範囲・
 * キーワード検索をAND条件で適用する。
 *
 * `now` は日付範囲（今月・直近3ヶ月・今年）の基準日。既定は現在時刻で、
 * テストから固定日を渡せるように引数にしてある。
 */
export function filterRecords(
  records: UnifiedRecord[],
  filters: RecordFilters,
  now: Date = new Date()
): UnifiedRecord[] {
  const query = filters.searchQuery.trim();

  // 日付の境界は全レコードで共通なので、絞り込みに入る前に一度だけ求める
  const dateBounds = resolveDateBounds(
    filters.dateRange,
    filters.customDateFrom,
    filters.customDateTo,
    now
  );

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
    const matchesPrice = matchesPriceRange(record.price, filters.priceRange);
    const matchesDate =
      (dateBounds.from === undefined || record.date >= dateBounds.from) &&
      (dateBounds.to === undefined || record.date <= dateBounds.to);
    return (
      matchesType &&
      matchesCategory &&
      matchesSearch &&
      matchesDrinkingStatus &&
      matchesRating &&
      matchesPrice &&
      matchesDate
    );
  });
}

/**
 * 価格帯の判定（Issue #47）。`min` 以上 `max` 未満で見る。
 *
 * 価格が未入力（null）の記録は、価格帯を選んだ時点で外す。
 * 「3,000円以上」に金額の分からない記録が混ざると、絞り込んだ意味が無くなるため。
 * 知らない選択肢が渡ってきたときは絞り込まない（保存値が壊れていても一覧を空にしない）。
 */
export function matchesPriceRange(
  price: number | null | undefined,
  priceRange: PriceRangeFilter
): boolean {
  if (priceRange === 'all') return true;
  const bounds = PRICE_RANGE_BOUNDS[priceRange];
  if (!bounds) return true;
  if (price == null) return false;
  return price >= bounds.min && price < bounds.max;
}

/**
 * キーワード検索の判定。酒名・店名・場所・飲み方・メモに加え、
 * 詳細スペックの文字列項目（蔵元・産地・特定名称・酒米・酵母）も横断して探す。
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
  const specs = record.specs;
  const fields = [
    record.storeName,
    record.placeName,
    record.drinkingMethod,
    record.memo,
    // 詳細スペックのうち、探し方として意味のある文字列項目（Issue #87）。
    // 紹介文はラベルの文章がそのまま入るため、検索対象にすると
    // ありふれた語（「香り」など）で無関係な記録が並ぶので外す
    specs?.brewery,
    specs?.region,
    specs?.specificName,
    specs?.riceVariety,
    specs?.yeast,
  ];
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
