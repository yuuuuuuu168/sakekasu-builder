import {
  DEFAULT_FILTERS,
  DEFAULT_SORT_OPTION,
  RECORD_TYPE_OPTIONS,
  CATEGORY_FILTER_OPTIONS,
  DRINKING_STATUS_OPTIONS,
  RATING_FILTER_OPTIONS,
  PRICE_RANGE_OPTIONS,
  DATE_RANGE_OPTIONS,
  SORT_OPTIONS,
  type RecordFilters,
  type SortOption,
} from '../types';
import { isValidDateString } from './dateRange';

/**
 * 検索語の上限。曖昧検索は記録数 × クエリ長で走るため、
 * 壊れた値や書き換えられた localStorage で無駄に長い文字列を掴まないようにする
 */
export const MAX_SEARCH_QUERY_LENGTH = 200;

/** 保存する絞り込み状態（並び替えも含める） */
export interface PersistedFilterState extends RecordFilters {
  sortOption: SortOption;
}

export const DEFAULT_FILTER_STATE: PersistedFilterState = {
  ...DEFAULT_FILTERS,
  sortOption: DEFAULT_SORT_OPTION,
};

/**
 * 絞り込み条件はユーザーごとに分けて保存する。
 * 同じ端末を別のアカウントで使ったときに、前の人の検索語が残らないようにする。
 */
function storageKey(userId: string): string {
  return `sakekasu:record-filters:${userId}`;
}

/** 選択肢に無い値が保存されていたら既定値に戻すためのヘルパー */
function pickValid<T>(
  candidate: unknown,
  options: { value: T }[],
  fallback: T
): T {
  return options.some((opt) => opt.value === candidate) ? (candidate as T) : fallback;
}

/**
 * localStorage は無効化されている場合（プライベートモード等）があるため、
 * 読み書きに失敗しても一覧の表示自体は続けられるようにする。
 */
export function loadFilterState(userId: string): PersistedFilterState {
  if (!userId) return DEFAULT_FILTER_STATE;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return DEFAULT_FILTER_STATE;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_FILTER_STATE;

    const stored = parsed as Partial<Record<keyof PersistedFilterState, unknown>>;
    return {
      recordType: pickValid(stored.recordType, RECORD_TYPE_OPTIONS, DEFAULT_FILTERS.recordType),
      category: pickValid(stored.category, CATEGORY_FILTER_OPTIONS, DEFAULT_FILTERS.category),
      drinkingStatus: pickValid(
        stored.drinkingStatus,
        DRINKING_STATUS_OPTIONS,
        DEFAULT_FILTERS.drinkingStatus
      ),
      rating: pickValid(stored.rating, RATING_FILTER_OPTIONS, DEFAULT_FILTERS.rating),
      priceRange: pickValid(
        stored.priceRange,
        PRICE_RANGE_OPTIONS,
        DEFAULT_FILTERS.priceRange
      ),
      dateRange: pickValid(stored.dateRange, DATE_RANGE_OPTIONS, DEFAULT_FILTERS.dateRange),
      // カスタム範囲の日付は選択肢が無いので、形（YYYY-MM-DD）と実在する日付かで見る。
      // 壊れていれば「その側の指定なし」に落とし、日付範囲の選択自体は残す
      customDateFrom: isValidDateString(stored.customDateFrom)
        ? stored.customDateFrom
        : DEFAULT_FILTERS.customDateFrom,
      customDateTo: isValidDateString(stored.customDateTo)
        ? stored.customDateTo
        : DEFAULT_FILTERS.customDateTo,
      sortOption: pickValid(stored.sortOption, SORT_OPTIONS, DEFAULT_SORT_OPTION),
      searchQuery:
        typeof stored.searchQuery === 'string'
          ? stored.searchQuery.slice(0, MAX_SEARCH_QUERY_LENGTH)
          : DEFAULT_FILTERS.searchQuery,
    };
  } catch (err) {
    console.error('絞り込み条件の読み込みに失敗しました:', err);
    return DEFAULT_FILTER_STATE;
  }
}

export function saveFilterState(userId: string, state: PersistedFilterState): void {
  if (!userId) return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch (err) {
    // 保存できなくても絞り込み自体は使えるようにする
    console.error('絞り込み条件の保存に失敗しました:', err);
  }
}

export function clearFilterState(userId: string): void {
  if (!userId) return;
  try {
    localStorage.removeItem(storageKey(userId));
  } catch (err) {
    console.error('絞り込み条件の削除に失敗しました:', err);
  }
}
