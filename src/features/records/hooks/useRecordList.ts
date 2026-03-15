import { useState, useMemo } from 'react';
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
  records: UnifiedRecord[];
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
}

export function useRecordList(): UseRecordListReturn {
  const { records: rawRecords, isLoading, error, refetch } = useRecordFetch();

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
    const filtered = filterRecords(rawRecords, recordType, category, searchQuery, drinkingStatusFilter);
    return sortRecords(filtered, sortOption);
  }, [rawRecords, recordType, category, sortOption, searchQuery, drinkingStatusFilter]);

  const hasActiveFilter =
    recordType !== 'all' || category !== 'all' || searchQuery !== '' || sortOption !== 'date-desc' || drinkingStatusFilter !== 'all';

  const resetFilters = () => {
    setRecordType('all');
    setCategory('all');
    setSortOptionState('date-desc');
    setSearchQuery('');
    setDrinkingStatusFilter('all');
  };

  return {
    records,
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
  };
}
