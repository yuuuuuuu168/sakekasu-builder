import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRecordFetch } from './useRecordFetch';
import { filterRecords } from './useRecordFilter';
import { sortRecords } from './useRecordSort';
import type {
  UnifiedRecord,
  RecordTypeFilter,
  CategoryFilter,
  SortOption,
  DrinkingStatusFilter,
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
  hasActiveFilter: boolean;
  setRecordType: (type: RecordTypeFilter) => void;
  setCategory: (category: CategoryFilter) => void;
  setSortOption: (option: SortOption) => void;
  setSearchQuery: (query: string) => void;
  setDrinkingStatusFilter: (status: DrinkingStatusFilter) => void;
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

  // 楽観的更新はフィルタ前の全記録に対して行う。
  // こうすることで在庫サマリーのような全体集計も即座に追従する
  const [allRecords, setAllRecords] = useState<UnifiedRecord[]>(fetchedRecords);

  useEffect(() => {
    setAllRecords(fetchedRecords);
  }, [fetchedRecords]);

  const [recordType, setRecordType] = useState<RecordTypeFilter>('all');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [sortOption, setSortOptionState] = useState<SortOption>('date-desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [drinkingStatusFilter, setDrinkingStatusFilter] = useState<DrinkingStatusFilter>('all');

  // 評価ソート選択時は自動で飲酒記録のみに絞り込む
  const setSortOption = (option: SortOption) => {
    setSortOptionState(option);
    if (option === 'rating-desc' || option === 'rating-asc') {
      setRecordType('drinking');
    }
  };

  // 飲みきりステータスフィルタ選択時は自動で購入記録のみに絞り込む
  const handleDrinkingStatusFilter = (status: DrinkingStatusFilter) => {
    setDrinkingStatusFilter(status);
    if (status !== 'all') {
      setRecordType('purchase');
    }
  };

  const records = useMemo(() => {
    const filtered = filterRecords(allRecords, recordType, category, searchQuery, drinkingStatusFilter);
    return sortRecords(filtered, sortOption);
  }, [allRecords, recordType, category, sortOption, searchQuery, drinkingStatusFilter]);

  const hasActiveFilter =
    recordType !== 'all' || category !== 'all' || searchQuery !== '' || sortOption !== 'date-desc' || drinkingStatusFilter !== 'all';

  const resetFilters = () => {
    setRecordType('all');
    setCategory('all');
    setSortOptionState('date-desc');
    setSearchQuery('');
    setDrinkingStatusFilter('all');
  };

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
    recordType,
    category,
    sortOption,
    searchQuery,
    drinkingStatusFilter,
    hasActiveFilter,
    setRecordType,
    setCategory,
    setSortOption,
    setSearchQuery,
    setDrinkingStatusFilter: handleDrinkingStatusFilter,
    resetFilters,
    refetch,
    removeRecord,
    restoreRecord,
    patchRecord,
  };
}
