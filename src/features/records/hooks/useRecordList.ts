import { useState, useMemo, useEffect, useCallback } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { useRecordFetch } from './useRecordFetch';
import { filterRecords } from './useRecordFilter';
import { sortRecords } from './useRecordSort';
import {
  loadFilterState,
  saveFilterState,
  DEFAULT_FILTER_STATE,
  type PersistedFilterState,
} from '../lib/filterStorage';
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT_OPTION,
  type UnifiedRecord,
  type RecordTypeFilter,
  type CategoryFilter,
  type SortOption,
  type DrinkingStatusFilter,
  type RatingFilter,
} from '../types';

export interface UseRecordListReturn {
  /** フィルタ・ソート適用後の表示用リスト */
  records: UnifiedRecord[];
  /** フィルタ適用前の全記録（在庫サマリーなど全体集計に使う） */
  allRecords: UnifiedRecord[];
  isLoading: boolean;
  error: string | null;
  recordType: RecordTypeFilter;
  category: CategoryFilter;
  sortOption: SortOption;
  searchQuery: string;
  drinkingStatusFilter: DrinkingStatusFilter;
  ratingFilter: RatingFilter;
  hasActiveFilter: boolean;
  setRecordType: (type: RecordTypeFilter) => void;
  setCategory: (category: CategoryFilter) => void;
  setSortOption: (option: SortOption) => void;
  setSearchQuery: (query: string) => void;
  setDrinkingStatusFilter: (status: DrinkingStatusFilter) => void;
  setRatingFilter: (rating: RatingFilter) => void;
  resetFilters: () => void;
  refetch: () => void;
  /** 楽観的更新: 記録を除去する */
  removeRecord: (id: string) => void;
  /** 楽観的更新: 除去した記録を戻す（並び順はソートで復元される） */
  restoreRecord: (record: UnifiedRecord) => void;
  /** 楽観的更新: 記録の一部フィールドを差し替える */
  patchRecord: (id: string, patch: Partial<UnifiedRecord>) => void;
}

export function useRecordList(): UseRecordListReturn {
  const { records: fetchedRecords, isLoading, error, refetch } = useRecordFetch();
  const { user } = useAuth();
  const userId = user?.userId ?? '';

  // 楽観的更新はフィルタ前の全記録に対して行う。
  // こうすることで在庫サマリーのような全体集計も即座に追従する
  const [allRecords, setAllRecords] = useState<UnifiedRecord[]>(fetchedRecords);

  useEffect(() => {
    setAllRecords(fetchedRecords);
  }, [fetchedRecords]);

  // タブを移動して戻ってきたときに絞り込み直さなくて済むよう、前回の条件を復元する。
  //
  // マウント時点で userId が確定していることが前提。AuthGuard が認証解決まで
  // 配下を描画しないため成り立つ（filterPersistence.integration.test.tsx で担保）。
  // この前提が崩れると空IDで初期化され、既定値が保存済みの条件を上書きしてしまう
  const [filterState, setFilterState] = useState<PersistedFilterState>(() =>
    loadFilterState(userId),
  );

  useEffect(() => {
    // サインアウト後など、ユーザーが確定していないときは書き込まない
    if (!userId) return;
    saveFilterState(userId, filterState);
  }, [userId, filterState]);

  const patchFilterState = useCallback((patch: Partial<PersistedFilterState>) => {
    setFilterState((prev) => ({ ...prev, ...patch }));
  }, []);

  const setRecordType = useCallback(
    (recordType: RecordTypeFilter) => patchFilterState({ recordType }),
    [patchFilterState],
  );

  const setCategory = useCallback(
    (category: CategoryFilter) => patchFilterState({ category }),
    [patchFilterState],
  );

  const setSearchQuery = useCallback(
    (searchQuery: string) => patchFilterState({ searchQuery }),
    [patchFilterState],
  );

  // 評価ソート選択時は自動で飲酒記録のみに絞り込む
  const setSortOption = useCallback(
    (sortOption: SortOption) => {
      const narrowsToDrinking = sortOption === 'rating-desc' || sortOption === 'rating-asc';
      patchFilterState({
        sortOption,
        ...(narrowsToDrinking && { recordType: 'drinking' as const }),
      });
    },
    [patchFilterState],
  );

  // 飲みきりステータスフィルタ選択時は自動で購入記録のみに絞り込む
  const setDrinkingStatusFilter = useCallback(
    (drinkingStatus: DrinkingStatusFilter) => {
      patchFilterState({
        drinkingStatus,
        ...(drinkingStatus !== 'all' && { recordType: 'purchase' as const }),
      });
    },
    [patchFilterState],
  );

  // 評価を持つのは飲酒記録だけなので、選んだら自動で飲酒記録に絞り込む
  const setRatingFilter = useCallback(
    (rating: RatingFilter) => {
      patchFilterState({
        rating,
        ...(rating !== 'all' && { recordType: 'drinking' as const }),
      });
    },
    [patchFilterState],
  );

  // PersistedFilterState は RecordFilters を含むのでそのまま渡せる（sortOption は無視される）
  const records = useMemo(() => {
    const filtered = filterRecords(allRecords, filterState);
    return sortRecords(filtered, filterState.sortOption);
  }, [allRecords, filterState]);

  const hasActiveFilter =
    filterState.recordType !== DEFAULT_FILTERS.recordType ||
    filterState.category !== DEFAULT_FILTERS.category ||
    filterState.searchQuery !== DEFAULT_FILTERS.searchQuery ||
    filterState.drinkingStatus !== DEFAULT_FILTERS.drinkingStatus ||
    filterState.rating !== DEFAULT_FILTERS.rating ||
    filterState.sortOption !== DEFAULT_SORT_OPTION;

  const resetFilters = useCallback(() => {
    setFilterState(DEFAULT_FILTER_STATE);
  }, []);

  const removeRecord = useCallback((id: string) => {
    setAllRecords((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const restoreRecord = useCallback((record: UnifiedRecord) => {
    setAllRecords((prev) => (prev.some((r) => r.id === record.id) ? prev : [...prev, record]));
  }, []);

  const patchRecord = useCallback((id: string, patch: Partial<UnifiedRecord>) => {
    setAllRecords((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  return {
    records,
    allRecords,
    isLoading,
    error,
    recordType: filterState.recordType,
    category: filterState.category,
    sortOption: filterState.sortOption,
    searchQuery: filterState.searchQuery,
    drinkingStatusFilter: filterState.drinkingStatus,
    ratingFilter: filterState.rating,
    hasActiveFilter,
    setRecordType,
    setCategory,
    setSortOption,
    setSearchQuery,
    setDrinkingStatusFilter,
    setRatingFilter,
    resetFilters,
    refetch,
    removeRecord,
    restoreRecord,
    patchRecord,
  };
}
