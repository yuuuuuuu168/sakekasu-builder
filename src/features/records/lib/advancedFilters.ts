import { DEFAULT_FILTERS, type RecordFilters } from '../types';

/**
 * 詳細フィルタに畳む条件。
 *
 * 常時出すのは、記録を探すときにまず触る4つ（キーワード検索・記録種別・
 * カテゴリ・並び替え）。それ以外は使う頻度が落ちるので、既定では隠しておく。
 *
 * 折りたたみの中身と「効いている条件の数」の数え方を、この1か所で決めている。
 * 片方だけ足すと、隠れているのにバッジに出ない条件ができてしまう
 */
export const ADVANCED_FILTER_KEYS = [
  'drinkingStatus',
  'rating',
  'priceRange',
  'dateRange',
] as const;

export type AdvancedFilterKey = (typeof ADVANCED_FILTER_KEYS)[number];

/**
 * 詳細フィルタのうち、既定値から動いている条件の数。
 *
 * 隠れたまま絞り込みが効いていると、記録が出ない理由が分からなくなる。
 * この数をバッジに出し、0 でなければ折りたたみを開いた状態で始める
 */
export function countActiveAdvancedFilters(
  filters: Pick<RecordFilters, AdvancedFilterKey>,
): number {
  return ADVANCED_FILTER_KEYS.filter((key) => filters[key] !== DEFAULT_FILTERS[key]).length;
}
