import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useRecordList } from '../hooks/useRecordList';
import { useDeleteRecord } from '../hooks/useDeleteRecord';
import { useUpdateDrinkingStatus } from '../hooks/useUpdateDrinkingStatus';
import { FilterControls } from './FilterControls';
import { RecordCard } from './RecordCard';
import { EditRecordDialog } from './EditRecordDialog';
import { EmptyState } from './EmptyState';
import { LoadingState } from './LoadingState';
import { ErrorState } from './ErrorState';
import { ImageModal } from '@/features/image/components/ImageModal';
import type { UnifiedRecord } from '../types';
import type { DrinkingStatus } from '@/types/schema';

export function RecordListPage() {
  const {
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
    setDrinkingStatusFilter,
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

  // 飲みきりステータスの楽観的更新
  const handleStatusOptimisticUpdate = useCallback((id: string, newStatus: DrinkingStatus) => {
    setDisplayRecords((prev) =>
      prev.map((r) => (r.id === id ? { ...r, drinkingStatus: newStatus } : r))
    );
  }, []);

  const handleStatusRollback = useCallback((id: string, oldStatus: DrinkingStatus) => {
    setDisplayRecords((prev) =>
      prev.map((r) => (r.id === id ? { ...r, drinkingStatus: oldStatus } : r))
    );
  }, []);

  const { updateStatus, isUpdating: isStatusUpdating } = useUpdateDrinkingStatus(
    handleStatusOptimisticUpdate,
    handleStatusRollback,
  );

  // 編集ダイアログの状態管理
  const [editingRecord, setEditingRecord] = useState<UnifiedRecord | null>(null);

  const handleEdit = useCallback((record: UnifiedRecord) => {
    setEditingRecord(record);
  }, []);

  const handleEditOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setEditingRecord(null);
    }
  }, []);

  const handleUpdated = useCallback(() => {
    void refetch();
  }, [refetch]);

  // ImageModal の状態管理
  const [modalImage, setModalImage] = useState<{ imageKeys: string[]; sakeName: string; index: number } | null>(null);

  const handleImageClick = useCallback((imageKeys: string[], sakeName: string, index: number) => {
    setModalImage({ imageKeys, sakeName, index });
  }, []);

  const handleModalClose = useCallback((open: boolean) => {
    if (!open) {
      setModalImage(null);
    }
  }, []);

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
            drinkingStatusFilter={drinkingStatusFilter}
            hasActiveFilter={hasActiveFilter}
            onRecordTypeChange={setRecordType}
            onCategoryChange={setCategory}
            onSearchQueryChange={setSearchQuery}
            onSortChange={setSortOption}
            onDrinkingStatusChange={setDrinkingStatusFilter}
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
                  onEdit={handleEdit}
                  onImageClick={handleImageClick}
                  onDrinkingStatusChange={updateStatus}
                  isStatusUpdating={isStatusUpdating}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* 編集ダイアログ（ページレベルで単一インスタンス） */}
      <EditRecordDialog
        record={editingRecord}
        onOpenChange={handleEditOpenChange}
        onUpdated={handleUpdated}
      />

      {/* 画像モーダル（ページレベルで単一インスタンス） */}
      {modalImage && (
        <ImageModal
          open={!!modalImage}
          onOpenChange={handleModalClose}
          imageKeys={modalImage.imageKeys}
          initialIndex={modalImage.index}
          sakeName={modalImage.sakeName}
        />
      )}
    </div>
  );
}
