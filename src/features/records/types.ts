import type { SakeCategory } from '../purchase/types';
import type { DrinkingStatus } from '@/types/schema';
import type { SakeSpecs } from '@/features/specs/types';

// 記録種別
export type RecordType = 'purchase' | 'drinking';

// 統合記録型: PurchaseRecord と DrinkingRecord を統一的に扱う
export interface UnifiedRecord {
  id: string;
  type: RecordType;
  sakeName: string;
  price: number | null;
  date: string; // YYYY-MM-DD（purchaseDate or drinkingDate）
  category: SakeCategory;
  memo?: string;
  /**
   * 詳細スペック（Issue #87）。任意項目なので、1つも入力していない記録では
   * 各項目が null になる。項目自体が無かった頃の記録では undefined
   */
  specs?: SakeSpecs;
  // 購入記録固有
  storeName?: string;
  quantity?: number; // 購入本数（1以上、未設定時は1扱い）
  /** まだ飲みきっていない本数（未設定なら quantity と同じ扱い。Issue #159） */
  remainingQuantity?: number;
  drinkingStatus?: DrinkingStatus;
  openedAt?: string | null; // 開封日時（飲み中に変更した日時、AWSDateTime）
  // 飲酒記録固有
  placeName?: string;
  drinkingMethod?: string;
  rating?: number; // 1〜5
  purchaseRecordId?: string | null; // 在庫（購入記録）から登録した場合の紐づけ先
  imageKey?: string | null;
  imageKeys: string[];
  createdAt: string;
  updatedAt: string;
}

// フィルタ型
export type RecordTypeFilter = 'all' | 'purchase' | 'drinking';
export type CategoryFilter = 'all' | SakeCategory;
export type DrinkingStatusFilter = 'all' | DrinkingStatus;
/** 評価フィルタ。数値は「その星数以上」を意味する */
export type RatingFilter = 'all' | 1 | 2 | 3 | 4 | 5;

/** 一覧に適用する絞り込み条件のまとまり */
export interface RecordFilters {
  recordType: RecordTypeFilter;
  category: CategoryFilter;
  searchQuery: string;
  drinkingStatus: DrinkingStatusFilter;
  rating: RatingFilter;
}

export const DEFAULT_FILTERS: RecordFilters = {
  recordType: 'all',
  category: 'all',
  searchQuery: '',
  drinkingStatus: 'all',
  rating: 'all',
};

// ソートオプション
export type SortOption = 'date-desc' | 'date-asc' | 'price-desc' | 'price-asc' | 'rating-desc' | 'rating-asc';

export const DEFAULT_SORT_OPTION: SortOption = 'date-desc';

// ソートオプションのラベルマッピング
export const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'date-desc', label: '日付（新しい順）' },
  { value: 'date-asc', label: '日付（古い順）' },
  { value: 'price-desc', label: '価格（高い順）' },
  { value: 'price-asc', label: '価格（低い順）' },
  { value: 'rating-desc', label: '評価（高い順）' },
  { value: 'rating-asc', label: '評価（低い順）' },
];

// 記録種別フィルタのラベルマッピング
export const RECORD_TYPE_OPTIONS: { value: RecordTypeFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'purchase', label: '購入記録' },
  { value: 'drinking', label: '飲酒記録' },
];

// 飲みきりステータスフィルタのラベルマッピング
export const DRINKING_STATUS_OPTIONS: { value: DrinkingStatusFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'NOT_STARTED', label: '未開封' },
  { value: 'IN_PROGRESS', label: '飲み中' },
  { value: 'FINISHED', label: '飲みきり' },
];

// 評価フィルタのラベルマッピング（高い方から並べる）
export const RATING_FILTER_OPTIONS: { value: RatingFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 5, label: '★5' },
  { value: 4, label: '★4以上' },
  { value: 3, label: '★3以上' },
  { value: 2, label: '★2以上' },
  { value: 1, label: '★1以上' },
];

// 飲みきりステータスの表示ラベル
export const DRINKING_STATUS_DISPLAY: Record<DrinkingStatus, string> = {
  NOT_STARTED: '未開封',
  IN_PROGRESS: '飲み中',
  FINISHED: '飲みきり',
};

// カテゴリフィルタのラベルマッピング
export const CATEGORY_FILTER_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'NIHONSHU', label: '日本酒' },
  { value: 'BEER', label: 'ビール' },
  { value: 'WINE', label: 'ワイン' },
  { value: 'WHISKY', label: 'ウイスキー' },
  { value: 'SHOCHU', label: '焼酎' },
  { value: 'OTHER', label: 'その他' },
];
