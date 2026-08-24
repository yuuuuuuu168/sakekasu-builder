import { useState } from 'react';
import { motion } from 'framer-motion';
import type { RecordType, UnifiedRecord } from '../types';
import { CATEGORY_FILTER_OPTIONS, DRINKING_STATUS_DISPLAY } from '../types';
import { DeleteButton } from './DeleteButton';
import { EditButton } from './EditButton';
import { ConfirmDialog } from './ConfirmDialog';
import { FinishBottlesDialog } from './FinishBottlesDialog';
import { RecordMemo } from './RecordMemo';
import { RecordSpecs } from './RecordSpecs';
import { useImageUrl } from '@/features/image/hooks/useImageUrl';
import { toThumbnailKey } from '@/features/image/lib/thumbnailKey';
import type { LinkedDrinkingSummary } from '../lib/linkedDrinking';
import { getBottleBreakdown, getRemainingBottles, toBottleCount } from '../lib/bottleCount';
import type { DrinkingStatus } from '@/types/schema';

interface RecordCardProps {
  record: UnifiedRecord;
  onDelete: (id: string, type: RecordType) => void;
  isDeleting: boolean;
  /** 編集ボタンクリック時のコールバック（対象記録を通知） */
  onEdit?: (record: UnifiedRecord) => void;
  /** サムネイルクリック時のコールバック（imageKeys, 銘柄名, クリックされたインデックスを通知） */
  onImageClick?: (imageKeys: string[], sakeName: string, index: number) => void;
  /**
   * 飲みきりステータス変更時のコールバック。
   * bottles は飲みきる本数（まとめ買いの記録で何本ぶんかを指定する）
   */
  onDrinkingStatusChange?: (record: UnifiedRecord, newStatus: DrinkingStatus, bottles?: number) => void;
  isStatusUpdating?: boolean;
  /** 在庫から飲酒登録へ進むときのコールバック（購入記録のみ） */
  onDrinkFromStock?: (record: UnifiedRecord) => void;
  /** この購入記録に紐づいた飲酒記録の集計（購入記録のみ） */
  linkedDrinking?: LinkedDrinkingSummary;
}

/** 飲みきりステータスのスタイル定義 */
const DRINKING_STATUS_STYLES: Record<DrinkingStatus, string> = {
  NOT_STARTED: 'bg-gray-100 text-gray-700 border border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600',
  IN_PROGRESS: 'bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-600',
  FINISHED: 'bg-green-50 text-green-800 border border-green-300 dark:bg-green-900/40 dark:text-green-300 dark:border-green-600',
};

/** 飲みきりステータスのアイコン */
const DRINKING_STATUS_ICONS: Record<DrinkingStatus, string> = {
  NOT_STARTED: '\u{1F4E6}',  // 📦
  IN_PROGRESS: '\u{1F376}',  // 🍶
  FINISHED: '\u{2705}',      // ✅
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

/**
 * 開封日時から経過日数ラベルを生成（日付単位で比較）。
 * 開封当日は「今日開封」、それ以降は「開封からN日」。
 * openedAt が未設定・不正・未来日付の場合は null（非表示）。
 */
function getOpenedDaysLabel(openedAt: string | null | undefined): string | null {
  if (!openedAt) return null;
  const opened = new Date(openedAt);
  if (Number.isNaN(opened.getTime())) return null;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.floor((startOfDay(new Date()) - startOfDay(opened)) / 86_400_000);
  if (days < 0) return null;
  return days === 0 ? '今日開封' : `開封から${days}日`;
}

/**
 * まとめ買いした記録の内訳ラベル（「飲み中 1本 / 未開封 2本」）。
 * 1本しかない記録ではステータスのバッジと同じことを言うだけなので出さない。
 */
function getBottleBreakdownLabel(record: UnifiedRecord): string | null {
  if (toBottleCount(record.quantity) <= 1) return null;

  const { notStarted, inProgress } = getBottleBreakdown(record);
  const parts: string[] = [];
  if (inProgress > 0) parts.push(`飲み中 ${inProgress}本`);
  if (notStarted > 0) parts.push(`未開封 ${notStarted}本`);
  return parts.length > 0 ? parts.join(' / ') : null;
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

/** サムネイル表示コンポーネント（先頭画像 + 枚数バッジ） */
function RecordThumbnail({
  imageKeys,
  sakeName,
  onClickImage,
}: {
  imageKeys: string[];
  sakeName: string;
  onClickImage: (index: number) => void;
}) {
  const firstKey = imageKeys[0] ?? null;
  // 一覧では軽いサムネイルを優先する。サムネイルが未生成の既存記録では
  // 読み込みに失敗するため、その場合だけ原画にフォールバックする。
  // フォールバックしたかどうかは「サムネイルが失敗したか」から毎レンダー
  // 導出する。effect で state を書き換えると、URL 取得の結果を受けて
  // もう一往復レンダーが走るため
  const [thumbnailImgFailed, setThumbnailImgFailed] = useState(false);
  const [originalImgFailed, setOriginalImgFailed] = useState(false);

  const thumbnail = useImageUrl(firstKey ? toThumbnailKey(firstKey) : null);
  // URL の取得自体に失敗した場合も原画へ切り替える。ここで諦めると
  // サムネイル側の一時的な失敗で画像が出なくなる
  const useOriginal = thumbnailImgFailed || thumbnail.hasError;
  // 原画の URL はフォールバックが要るときだけ取りにいく（null なら取得しない）
  const original = useImageUrl(useOriginal ? firstKey : null);

  const { imageUrl, isLoading, hasError } = useOriginal ? original : thumbnail;
  const count = imageKeys.length;

  const handleImgError = () => {
    if (useOriginal) {
      setOriginalImgFailed(true);
      return;
    }
    setThumbnailImgFailed(true);
  };

  if (count === 0) {
    return <ImagePlaceholder />;
  }

  if (isLoading) {
    return <ThumbnailSkeleton />;
  }

  if (hasError || !imageUrl || originalImgFailed) {
    return <ImagePlaceholder />;
  }

  return (
    <button
      type="button"
      onClick={() => onClickImage(0)}
      className="relative h-20 w-20 flex-shrink-0 cursor-pointer overflow-hidden rounded-lg transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-sake-gold/50"
      aria-label={`${sakeName}の画像を拡大表示`}
      data-testid="record-thumbnail"
    >
      <img
        src={imageUrl}
        alt={`${sakeName}の画像`}
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        onError={handleImgError}
      />
      {count > 1 && (
        <span
          className="absolute bottom-1 right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-black/60 px-1 text-[10px] font-bold text-white"
          data-testid="image-count-badge"
        >
          +{count - 1}
        </span>
      )}
    </button>
  );
}

export function RecordCard({ record, onDelete, isDeleting, onEdit, onImageClick, onDrinkingStatusChange, isStatusUpdating, onDrinkFromStock, linkedDrinking }: RecordCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const isPurchase = record.type === 'purchase';
  const priceText = formatPrice(record.price);
  // 飲みきった在庫からは登録できないようにする
  const canDrinkFromStock =
    isPurchase && !!onDrinkFromStock && (record.drinkingStatus ?? 'NOT_STARTED') !== 'FINISHED';
  const remainingBottles = isPurchase ? getRemainingBottles(record) : 0;
  const breakdownLabel = isPurchase ? getBottleBreakdownLabel(record) : null;

  const handleThumbnailClick = (index: number) => {
    onImageClick?.(record.imageKeys, record.sakeName, index);
  };

  // ステータスのバッジを押したとき。まとめ買いの記録を飲みきるときだけ、
  // 何本ぶんかをダイアログで聞いてから減らす
  const handleStatusClick = () => {
    if (!onDrinkingStatusChange || !record.drinkingStatus) return;

    const nextStatus = getNextStatus(record.drinkingStatus);
    if (nextStatus === 'FINISHED' && remainingBottles > 1) {
      setFinishOpen(true);
      return;
    }
    onDrinkingStatusChange(record, nextStatus);
  };

  const handleFinishBottles = (bottles: number) => {
    setFinishOpen(false);
    onDrinkingStatusChange?.(record, 'FINISHED', bottles);
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
        {/* 表示対象の画像が変わったらフォールバック状態を捨てたいので、
            先頭キーを key にして作り直す */}
        <RecordThumbnail
          key={record.imageKeys[0] ?? 'no-image'}
          imageKeys={record.imageKeys}
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
              {onEdit && (
                <EditButton
                  onClick={() => onEdit(record)}
                  disabled={isDeleting}
                />
              )}
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

          {/* 購入記録: 飲みきりステータス + 在庫からの飲酒登録 */}
          {isPurchase && (record.drinkingStatus || canDrinkFromStock) && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {record.drinkingStatus && (
              <button
                type="button"
                onClick={handleStatusClick}
                disabled={isStatusUpdating}
                className={`rounded-lg px-3 py-1.5 text-sm font-bold shadow-sm transition-all hover:scale-105 hover:shadow-md active:scale-95 disabled:opacity-50 ${DRINKING_STATUS_STYLES[record.drinkingStatus]}`}
                data-testid="drinking-status"
                title="クリックでステータスを変更"
              >
                {DRINKING_STATUS_ICONS[record.drinkingStatus]} {DRINKING_STATUS_DISPLAY[record.drinkingStatus]}
              </button>
              )}
              {breakdownLabel && (
                <span
                  className="text-xs font-medium text-gray-600 dark:text-gray-300"
                  data-testid="bottle-breakdown"
                >
                  {breakdownLabel}
                </span>
              )}
              {record.drinkingStatus === 'IN_PROGRESS' && getOpenedDaysLabel(record.openedAt) && (
                <span
                  className="text-xs font-medium text-amber-700 dark:text-amber-400"
                  data-testid="opened-days"
                >
                  {getOpenedDaysLabel(record.openedAt)}
                </span>
              )}
              {canDrinkFromStock && (
                <button
                  type="button"
                  onClick={() => onDrinkFromStock?.(record)}
                  className="rounded-lg border border-sake-gold/40 bg-sake-gold/10 px-3 py-1.5 text-sm font-bold text-sake-gold shadow-sm transition-all hover:scale-105 hover:shadow-md active:scale-95"
                  data-testid="drink-from-stock"
                  title="この在庫の飲酒記録を登録する"
                >
                  🍶 これを飲む
                </button>
              )}
            </div>
          )}

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

            {/* 購入記録: 本数 */}
            {isPurchase && record.quantity != null && (
              <span data-testid="quantity">📦 {record.quantity}本</span>
            )}

            {/* 1本ずつ飲んで購入本数より減っていれば、残りも出す */}
            {isPurchase && remainingBottles < toBottleCount(record.quantity) && (
              <span data-testid="remaining-quantity">残り {remainingBottles}本</span>
            )}

            {/* 飲酒記録: 飲み方 */}
            {!isPurchase && record.drinkingMethod && (
              <span data-testid="drinking-method">🍶 {record.drinkingMethod}</span>
            )}
          </div>

          {/* 詳細スペック（Issue #87）。値のある項目だけを畳んで置く */}
          <RecordSpecs specs={record.specs} />

          {/* 備考（テイスティングノートもここに入る）。長いものは2行で切って、
              クリックで全文に広げる */}
          {record.memo && <RecordMemo memo={record.memo} />}

          {/* 購入記録: 紐づいた飲酒記録の感想 */}
          {isPurchase && linkedDrinking && (
            <div
              className="mt-2 rounded-lg border border-sake-gold/20 bg-sake-gold/5 px-2.5 py-1.5 text-xs"
              data-testid="linked-drinking"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-600 dark:text-gray-300">
                <span className="font-semibold">🍶 飲んだ記録 {linkedDrinking.count}件</span>
                {linkedDrinking.averageRating !== null && (
                  <span className="text-yellow-500" data-testid="linked-drinking-rating">
                    ★ {linkedDrinking.averageRating}
                  </span>
                )}
                {linkedDrinking.latestDate && (
                  <span className="text-gray-500 dark:text-gray-400">
                    最終 {linkedDrinking.latestDate}
                  </span>
                )}
              </div>
              {linkedDrinking.latestMemo && (
                <p
                  className="mt-1 line-clamp-2 text-gray-600 dark:text-gray-400"
                  data-testid="linked-drinking-memo"
                >
                  {linkedDrinking.latestMemo}
                </p>
              )}
            </div>
          )}

          {/* 飲酒記録: 評価 */}
          {!isPurchase && record.rating != null && record.rating > 0 && (
            <div className="mt-2" data-testid="rating">
              <RatingStars rating={record.rating} />
            </div>
          )}
        </div>
      </div>

      {/* まとめ買いを飲みきるときの本数入力。
          開くたびに作り直して、前回入力した本数を持ち越さないようにする */}
      {isPurchase && finishOpen && (
        <FinishBottlesDialog
          open
          onOpenChange={setFinishOpen}
          sakeName={record.sakeName}
          remaining={remainingBottles}
          isUpdating={!!isStatusUpdating}
          onConfirm={handleFinishBottles}
        />
      )}

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
