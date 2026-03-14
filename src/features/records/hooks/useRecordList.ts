import { useState, useMemo } from 'react';
import { useRecordFetch } from './useRecordFetch';
import { filterRecords } from './useRecordFilter';
import { sortRecords } from './useRecordSort';
import type {
  UnifiedRecord,
  RecordTypeFilter,
  CategoryFilter,
  SortOption,
} from '../types';

export interface UseRecordListReturn {
  records: UnifiedRecord[];
  isLoading: boolean;
  error: string | null;
  recordType: RecordTypeFilter;
  category: CategoryFilter;
  sortOption: SortOption;
  searchQuery: string;
  hasActiveFilter: boolean;
  setRecordType: (type: RecordTypeFilter) => void;
  setCategory: (category: CategoryFilter) => void;
  setSortOption: (option: SortOption) => void;
  setSearchQuery: (query: string) => void;
  resetFilters: () => void;
  refetch: () => void;
}

export function useRecordList(): UseRecordListReturn {
  const { records: rawRecords, isLoading, error, refetch } = useRecordFetch();

  const [recordType, setRecordType] = useState<RecordTypeFilter>('all');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [sortOption, setSortOptionState] = useState<SortOption>('date-desc');
  const [searchQuery, setSearchQuery] = useState('');

  // 評価ソート選択時は自動で飲酒記録のみに絞り込む
  const setSortOption = (option: SortOption) => {
    setSortOptionState(option);
    if (option === 'rating-desc' || option === 'rating-asc') {
      setRecordType('drinking');
    }
  };

  const records = useMemo(() => {
    const filtered = filterRecords(rawRecords, recordType, category, searchQuery);
    return sortRecords(filtered, sortOption);
  }, [rawRecords, recordType, category, sortOption, searchQuery]);

  const hasActiveFilter =
    recordType !== 'all' || category !== 'all' || searchQuery !== '' || sortOption !== 'date-desc';

  const resetFilters = () => {
    setRecordType('all');
    setCategory('all');
    setSortOptionState('date-desc');
    setSearchQuery('');
  };

  return {
    records,
    isLoading,
    error,
    recordType,
    category,
    sortOption,
    searchQuery,
    hasActiveFilter,
    setRecordType,
    setCategory,
    setSortOption,
    setSearchQuery,
    resetFilters,
    refetch,
  };
}
