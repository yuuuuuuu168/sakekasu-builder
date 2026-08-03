import type { SakeCategory } from '../purchase/types';
import type { DrinkingStatus } from '@/types/schema';

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
  // 購入記録固有
  storeName?: string;
  quantity?: number; // 購入本数（1以上、未設定時は1扱い）
  drinkingStatus?: DrinkingStatus;
  // 飲酒記録固有
  placeName?: string;
  drinkingMethod?: string;
  rating?: number; // 1〜5
  imageKey?: string | null;
  imageKeys: string[];
  createdAt: string;
  updatedAt: string;
}

// フィルタ型
export type RecordTypeFilter = 'all' | 'purchase' | 'drinking';
export type CategoryFilter = 'all' | SakeCategory;
export type DrinkingStatusFilter = 'all' | DrinkingStatus;

// ソートオプション
export type SortOption = 'date-desc' | 'date-asc' | 'price-desc' | 'price-asc' | 'rating-desc' | 'rating-asc';

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
