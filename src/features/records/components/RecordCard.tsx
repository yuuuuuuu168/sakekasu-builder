import { useState } from 'react';
import { motion } from 'framer-motion';
import type { RecordType, UnifiedRecord } from '../types';
import { CATEGORY_FILTER_OPTIONS, DRINKING_STATUS_DISPLAY } from '../types';
import { DeleteButton } from './DeleteButton';
import { ConfirmDialog } from './ConfirmDialog';
import { useImageUrl } from '@/features/image/hooks/useImageUrl';
import type { DrinkingStatus } from '@/types/schema';

interface RecordCardProps {
  record: UnifiedRecord;
  onDelete: (id: string, type: RecordType) => void;
  isDeleting: boolean;
  /** サムネイルクリック時のコールバック（画像URL と銘柄名を通知） */
  onImageClick?: (imageUrl: string, sakeName: string) => void;
  /** 飲みきりステータス変更時のコールバック */
  onDrinkingStatusChange?: (id: string, newStatus: DrinkingStatus) => void;
  isStatusUpdating?: boolean;
}

/** 飲みきりステータスのスタイル定義 */
const DRINKING_STATUS_STYLES: Record<DrinkingStatus, string> = {
  NOT_STARTED: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  IN_PROGRESS: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  FINISHED: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
};

/** 次のステータスを取得 */
function getNextStatus(current: DrinkingStatus): DrinkingStatus {
  switch (current) {
    case 'NOT_STARTED':
      return 'IN_PROGRESS';
    case 'IN_PROGRESS':
      return 'FINISHED';
    case 'FINISHED':
      return 'NOT_STARTED';
  }
}

/** カテゴリ値から日本語ラベルを取得 */
function getCategoryLabel(category: string): string {
  const option = CATEGORY_FILTER_OPTIONS.find((o) => o.value === category);
  return option?.label ?? category;
}

/** 価格を ¥ 表記でフォーマット */
function formatPrice(price: number | null): string | null {
  if (price === null) return null;
  return `¥${price.toLocaleString()}`;
}

/** 評価を★で表示 */
function RatingStars({ rating }: { rating: number }) {
  return (
    <span className="text-yellow-400" data-testid="rating-stars">
      {'★'.repeat(rating)}
      {'☆'.repeat(5 - rating)}
    </span>
  );
}

/** 画像プレースホルダーアイコン */
function ImagePlaceholder() {
  return (
    <div
      className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800"
      data-testid="image-placeholder"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-8 w-8 text-gray-400 dark:text-gray-500"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    </div>
  );
}

/** スケルトンローダー */
function ThumbnailSkeleton() {
  return (
    <div
      className="h-20 w-20 flex-shrink-0 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"
      data-testid="thumbnail-skeleton"
    />
  );
}

/** サムネイル表示コンポーネント */
function RecordThumbnail({
  imageKey,
  sakeName,
  onClickImage,
}: {
  imageKey: string | null | undefined;
  sakeName: string;
  onClickImage: (url: string) => void;
}) {
  const { imageUrl, isLoading, hasError } = useImageUrl(imageKey ?? null);
  const [imgError, setImgError] = useState(false);

  // imageKey がない場合はプレースホルダー
  if (!imageKey) {
    return <ImagePlaceholder />;
  }

  // 読み込み中
  if (isLoading) {
    return <ThumbnailSkeleton />;
  }

  // エラーまたは URL 取得失敗
  if (hasError || !imageUrl || imgError) {
    return <ImagePlaceholder />;
  }

  return (
    <button
      type="button"
      onClick={() => onClickImage(imageUrl)}
      className="h-20 w-20 flex-shrink-0 cursor-pointer overflow-hidden rounded-lg transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-sake-gold/50"
      aria-label={`${sakeName}の画像を拡大表示`}
      data-testid="record-thumbnail"
    >
      <img
        src={imageUrl}
        alt={`${sakeName}の画像`}
        className="h-full w-full object-cover"
        onError={() => setImgError(true)}
      />
    </button>
  );
}

export function RecordCard({ record, onDelete, isDeleting, onImageClick, onDrinkingStatusChange, isStatusUpdating }: RecordCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isPurchase = record.type === 'purchase';
  const priceText = formatPrice(record.price);

  const handleThumbnailClick = (url: string) => {
    onImageClick?.(url, record.sakeName);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -80 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      className="rounded-xl border border-white/20 bg-white/80 p-4 shadow-sm backdrop-blur-lg transition-shadow hover:shadow-md dark:bg-white/5"
      data-testid="record-card"
    >
      <div className="flex gap-3">
        {/* サムネイル */}
        <RecordThumbnail
          imageKey={record.imageKey}
          sakeName={record.sakeName}
          onClickImage={handleThumbnailClick}
        />

        {/* コンテンツ */}
        <div className="min-w-0 flex-1">
          {/* ヘッダー: 種別ラベル + 削除ボタン + 日付 */}
          <div className="mb-3 flex items-center justify-between">
            <span
              className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                isPurchase
                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                  : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
              }`}
              data-testid="record-type-label"
            >
              {isPurchase ? '購入' : '飲酒'}
            </span>
            <div className="flex items-center gap-2">
              <time
                className="text-sm text-gray-500 dark:text-gray-400"
                dateTime={record.date}
                data-testid="record-date"
              >
                {record.date}
              </time>
              <DeleteButton
                onClick={() => setConfirmOpen(true)}
                disabled={isDeleting}
              />
            </div>
          </div>

          {/* 銘柄名 */}
          <h3
            className="mb-2 text-base font-bold text-gray-900 dark:text-gray-100 sm:text-lg"
            data-testid="sake-name"
          >
            {record.sakeName}
          </h3>

          {/* 詳細情報 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
            {/* カテゴリ */}
            <span
              className="rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-800"
              data-testid="category-label"
            >
              {getCategoryLabel(record.category)}
            </span>

            {/* 購入記録: 飲みきりステータス */}
            {isPurchase && record.drinkingStatus && (
              <button
                type="button"
                onClick={() => {
                  if (onDrinkingStatusChange && record.drinkingStatus) {
                    onDrinkingStatusChange(record.id, getNextStatus(record.drinkingStatus));
                  }
                }}
                disabled={isStatusUpdating}
                className={`rounded-full px-2 py-0.5 text-xs font-semibold transition-colors hover:opacity-80 disabled:opacity-50 ${DRINKING_STATUS_STYLES[record.drinkingStatus]}`}
                data-testid="drinking-status"
                title="クリックでステータスを変更"
              >
                {DRINKING_STATUS_DISPLAY[record.drinkingStatus]}
              </button>
            )}

            {/* 購入記録: 店舗 */}
            {isPurchase && record.storeName && (
              <span data-testid="store-name">🏪 {record.storeName}</span>
            )}

            {/* 飲酒記録: 場所 */}
            {!isPurchase && record.placeName && (
              <span data-testid="place-name">📍 {record.placeName}</span>
            )}

            {/* 価格 */}
            {priceText && (
              <span className="font-medium" data-testid="price">
                {priceText}
              </span>
            )}

            {/* 飲酒記録: 飲み方 */}
            {!isPurchase && record.drinkingMethod && (
              <span data-testid="drinking-method">🍶 {record.drinkingMethod}</span>
            )}
          </div>

          {/* 飲酒記録: 評価 */}
          {!isPurchase && record.rating != null && record.rating > 0 && (
            <div className="mt-2" data-testid="rating">
              <RatingStars rating={record.rating} />
            </div>
          )}
        </div>
      </div>

      {/* 削除確認ダイアログ */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        sakeName={record.sakeName}
        recordType={record.type}
        isDeleting={isDeleting}
        onConfirm={() => onDelete(record.id, record.type)}
      />
    </motion.div>
  );
}
