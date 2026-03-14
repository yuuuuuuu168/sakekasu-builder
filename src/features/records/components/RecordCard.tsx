import type { UnifiedRecord } from '../types';
import { CATEGORY_FILTER_OPTIONS } from '../types';

interface RecordCardProps {
  record: UnifiedRecord;
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

export function RecordCard({ record }: RecordCardProps) {
  const isPurchase = record.type === 'purchase';
  const priceText = formatPrice(record.price);

  return (
    <div
      className="rounded-xl border border-white/20 bg-white/80 p-4 shadow-sm backdrop-blur-lg transition-shadow hover:shadow-md dark:bg-white/5"
      data-testid="record-card"
    >
      {/* ヘッダー: 種別ラベル + 日付 */}
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
        <time
          className="text-sm text-gray-500 dark:text-gray-400"
          dateTime={record.date}
          data-testid="record-date"
        >
          {record.date}
        </time>
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
  );
}
