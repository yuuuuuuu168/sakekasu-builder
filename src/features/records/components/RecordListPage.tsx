import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useRecordList } from '../hooks/useRecordList';
import { useDeleteRecord } from '../hooks/useDeleteRecord';
import { FilterControls } from './FilterControls';
import { RecordCard } from './RecordCard';
import { EmptyState } from './EmptyState';
import { LoadingState } from './LoadingState';
import { ErrorState } from './ErrorState';
import type { UnifiedRecord } from '../types';

export function RecordListPage() {
  const {
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
  } = useRecordList();

  // 楽観的UI更新用のローカル state
  const [displayRecords, setDisplayRecords] = useState<UnifiedRecord[]>(records);

  // records が変更されたら displayRecords を同期
  useEffect(() => {
    setDisplayRecords(records);
  }, [records]);

  // 楽観的に記録を除去
  const handleOptimisticRemove = useCallback((id: string) => {
    setDisplayRecords((prev) => prev.filter((r) => r.id !== id));
  }, []);

  // 失敗時に記録を復元
  const handleRollback = useCallback((record: UnifiedRecord) => {
    setDisplayRecords((prev) => [...prev, record]);
  }, []);

  // 成功時のコールバック（no-op: ダイアログ閉じはRecordCard側で管理）
  const handleSuccess = useCallback(() => {}, []);

  const { deleteRecord, isDeleting } = useDeleteRecord(
    records,
    handleOptimisticRemove,
    handleRollback,
    handleSuccess,
  );

  return (
    <div className="min-h-screen bg-white dark:bg-dark-bg">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        {/* Header */}
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-indigo-wa dark:text-dark-gold sm:text-2xl">
            🍶 記録一覧
          </h1>
          <ThemeToggle />
        </header>

        {/* フィルタ・ソートコントロール */}
        <div className="mb-6">
          <FilterControls
            recordType={recordType}
            category={category}
            searchQuery={searchQuery}
            sortOption={sortOption}
            hasActiveFilter={hasActiveFilter}
            onRecordTypeChange={setRecordType}
            onCategoryChange={setCategory}
            onSearchQueryChange={setSearchQuery}
            onSortChange={setSortOption}
            onReset={resetFilters}
          />
        </div>

        {/* コンテンツ */}
        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : displayRecords.length === 0 ? (
          <EmptyState hasActiveFilter={hasActiveFilter} />
        ) : (
          <div className="space-y-4">
            <AnimatePresence>
              {displayRecords.map((record) => (
                <RecordCard
                  key={record.id}
                  record={record}
                  onDelete={deleteRecord}
                  isDeleting={isDeleting}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
