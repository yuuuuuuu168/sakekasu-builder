import { useState } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Star, Store } from 'lucide-react';
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
import { RatingMark } from '@/components/RatingMark';

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

/**
 * 飲みきりステータスのスタイル定義。
 * 色を付けるのは「飲み中」（いま手元で開いている）だけにし、未開封と飲みきりは無彩色で分ける
 */
const DRINKING_STATUS_STYLES: Record<DrinkingStatus, string> = {
  NOT_STARTED: 'border-border bg-card text-ink-2 hover:bg-muted',
  IN_PROGRESS: 'border-gold-line bg-gold-line/15 text-gold-ink hover:bg-gold-line/25',
  FINISHED: 'border-border bg-muted text-muted-foreground hover:bg-muted/70',
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
    <span
      className="inline-flex items-center gap-0.5"
      role="img"
      aria-label={`評価 ${rating}（5段階）`}
      data-testid="rating-stars"
    >
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={`size-4 ${i < rating ? 'fill-current text-gold-ink' : 'text-border'}`}
          strokeWidth={1.5}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

/** 画像プレースホルダーアイコン */
function ImagePlaceholder() {
  return (
    <div
      className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-lg bg-muted"
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
        className="h-8 w-8 text-muted-foreground"
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
      className="h-20 w-20 flex-shrink-0 animate-pulse rounded-lg bg-muted" /* check-ui-ignore: 画像の読み込み中だけ出すスケルトン */
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
      className="relative h-20 w-20 flex-shrink-0 cursor-pointer overflow-hidden rounded-lg transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-xl border border-border bg-card p-4 shadow-sm"
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
          {/* ヘッダー: 種別ラベル + 日付 + 編集・削除ボタン。
              種別の点の色はカレンダーの凡例（買った日・飲んだ日）とそろえる */}
          <div className="mb-1 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
              <span
                className={`size-1.5 rounded-full ${isPurchase ? 'bg-gold-line' : 'bg-indigo-wa dark:bg-ink-2'}`}
                aria-hidden="true"
              />
              <span data-testid="record-type-label">{isPurchase ? '購入' : '飲酒'}</span>
            </span>
            <div className="flex items-center gap-1">
              <time
                className="mr-1 text-sm text-muted-foreground tabular-nums"
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
            className="mb-2 text-base font-bold leading-snug text-foreground sm:text-lg"
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
                className={`min-h-9 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50 ${DRINKING_STATUS_STYLES[record.drinkingStatus]}`}
                data-testid="drinking-status"
                title="押すとステータスを次へ進める"
              >
                {DRINKING_STATUS_DISPLAY[record.drinkingStatus]}
              </button>
              )}
              {breakdownLabel && (
                <span
                  className="text-xs font-medium text-ink-2"
                  data-testid="bottle-breakdown"
                >
                  {breakdownLabel}
                </span>
              )}
              {record.drinkingStatus === 'IN_PROGRESS' && getOpenedDaysLabel(record.openedAt) && (
                <span
                  className="text-xs font-medium text-gold-ink"
                  data-testid="opened-days"
                >
                  {getOpenedDaysLabel(record.openedAt)}
                </span>
              )}
              {canDrinkFromStock && (
                <button
                  type="button"
                  onClick={() => onDrinkFromStock?.(record)}
                  className="min-h-9 rounded-lg border border-primary/40 px-3 py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
                  data-testid="drink-from-stock"
                  title="この在庫の飲酒記録を登録する"
                >
                  これを飲む
                </button>
              )}
            </div>
          )}

          {/* 詳細情報 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
            {/* カテゴリ */}
            <span
              className="rounded bg-muted px-1.5 py-0.5 text-xs"
              data-testid="category-label"
            >
              {getCategoryLabel(record.category)}
            </span>

            {/* 購入記録: 店舗 */}
            {isPurchase && record.storeName && (
              <span className="inline-flex items-center gap-1" data-testid="store-name">
                <Store className="size-3.5 shrink-0" strokeWidth={1.5} aria-label="店" />
                {record.storeName}
              </span>
            )}

            {/* 飲酒記録: 場所 */}
            {!isPurchase && record.placeName && (
              <span className="inline-flex items-center gap-1" data-testid="place-name">
                <MapPin className="size-3.5 shrink-0" strokeWidth={1.5} aria-label="場所" />
                {record.placeName}
              </span>
            )}

            {/* 価格 */}
            {priceText && (
              <span className="font-medium tabular-nums" data-testid="price">
                {priceText}
              </span>
            )}

            {/* 購入記録: 本数 */}
            {isPurchase && record.quantity != null && (
              <span className="tabular-nums" data-testid="quantity">{record.quantity}本</span>
            )}

            {/* 1本ずつ飲んで購入本数より減っていれば、残りも出す */}
            {isPurchase && remainingBottles < toBottleCount(record.quantity) && (
              <span className="tabular-nums" data-testid="remaining-quantity">残り {remainingBottles}本</span>
            )}

            {/* 飲酒記録: 飲み方 */}
            {!isPurchase && record.drinkingMethod && (
              <span data-testid="drinking-method">{record.drinkingMethod}</span>
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
              className="mt-3 border-t border-border pt-2 text-xs"
              data-testid="linked-drinking"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-2">
                <span className="font-semibold">飲んだ記録 {linkedDrinking.count}件</span>
                {linkedDrinking.averageRating !== null && (
                  <span data-testid="linked-drinking-rating">
                    <RatingMark value={linkedDrinking.averageRating} />
                  </span>
                )}
                {linkedDrinking.latestDate && (
                  <span className="text-muted-foreground tabular-nums">
                    最終 {linkedDrinking.latestDate}
                  </span>
                )}
              </div>
              {linkedDrinking.latestMemo && (
                <p
                  className="mt-1 line-clamp-2 text-ink-2"
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
