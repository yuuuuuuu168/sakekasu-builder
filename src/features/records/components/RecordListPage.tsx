import { useState, useCallback, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useRecordList } from '../hooks/useRecordList';
import { useDeleteRecord } from '../hooks/useDeleteRecord';
import { useUpdateDrinkingStatus } from '../hooks/useUpdateDrinkingStatus';
import { FilterControls } from './FilterControls';
import { InventorySummary } from './InventorySummary';
import { RecordCard } from './RecordCard';
import { EditRecordDialog } from './EditRecordDialog';
import { EmptyState } from './EmptyState';
import { LoadingState } from './LoadingState';
import { ErrorState } from './ErrorState';
import { ImageModal } from '@/features/image/components/ImageModal';
import { buildLinkedDrinkingIndex } from '../lib/linkedDrinking';
import type { UnifiedRecord } from '../types';
import type { DrinkingStatus } from '@/types/schema';

interface RecordListPageProps {
  /** 在庫（購入記録）から飲酒登録へ進むときのコールバック */
  onDrinkFromStock?: (record: UnifiedRecord) => void;
}

export function RecordListPage({ onDrinkFromStock }: RecordListPageProps = {}) {
  const {
    records,
    allRecords,
    isLoading,
    error,
    recordType,
    category,
    sortOption,
    searchQuery,
    drinkingStatusFilter,
    ratingFilter,
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
  } = useRecordList();

  // 成功時のコールバック（no-op: ダイアログ閉じはRecordCard側で管理）
  const handleSuccess = useCallback(() => {}, []);

  const { deleteRecord, isDeleting } = useDeleteRecord(
    allRecords,
    removeRecord,
    restoreRecord,
    handleSuccess,
  );

  // 飲みきりステータスの楽観的更新（openedAtUpdate が undefined の場合は開封日時を変更しない）
  const handleStatusOptimisticUpdate = useCallback(
    (id: string, newStatus: DrinkingStatus, openedAtUpdate?: string | null) => {
      patchRecord(id, {
        drinkingStatus: newStatus,
        ...(openedAtUpdate !== undefined && { openedAt: openedAtUpdate }),
      });
    },
    [patchRecord],
  );

  const handleStatusRollback = useCallback(
    (id: string, oldStatus: DrinkingStatus) => {
      patchRecord(id, { drinkingStatus: oldStatus });
    },
    [patchRecord],
  );

  const { updateStatus, isUpdating: isStatusUpdating } = useUpdateDrinkingStatus(
    handleStatusOptimisticUpdate,
    handleStatusRollback,
  );

  // 購入記録 → 紐づいた飲酒記録の感想を引くための索引
  const linkedDrinkingIndex = useMemo(
    () => buildLinkedDrinkingIndex(allRecords),
    [allRecords],
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

        {/* 在庫本数サマリー（フィルタに関係なく全体の在庫を表示） */}
        {!isLoading && !error && (
          <div className="mb-4">
            <InventorySummary records={allRecords} />
          </div>
        )}

        {/* フィルタ・ソートコントロール */}
        <div className="mb-6">
          <FilterControls
            recordType={recordType}
            category={category}
            searchQuery={searchQuery}
            sortOption={sortOption}
            drinkingStatusFilter={drinkingStatusFilter}
            ratingFilter={ratingFilter}
            hasActiveFilter={hasActiveFilter}
            onRecordTypeChange={setRecordType}
            onCategoryChange={setCategory}
            onSearchQueryChange={setSearchQuery}
            onSortChange={setSortOption}
            onDrinkingStatusChange={setDrinkingStatusFilter}
            onRatingChange={setRatingFilter}
            onReset={resetFilters}
          />
        </div>

        {/* コンテンツ */}
        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : records.length === 0 ? (
          <EmptyState hasActiveFilter={hasActiveFilter} />
        ) : (
          <div className="space-y-4">
            <AnimatePresence>
              {records.map((record) => (
                <RecordCard
                  key={record.id}
                  record={record}
                  onDelete={deleteRecord}
                  isDeleting={isDeleting}
                  onEdit={handleEdit}
                  onImageClick={handleImageClick}
                  onDrinkingStatusChange={updateStatus}
                  isStatusUpdating={isStatusUpdating}
                  onDrinkFromStock={onDrinkFromStock}
                  linkedDrinking={linkedDrinkingIndex.get(record.id)}
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
