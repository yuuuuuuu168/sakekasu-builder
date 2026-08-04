import type { SakeCategory } from '../purchase/types';
import type { DrinkingStatus } from '@/types/schema';

// 飲み方の型定義
export type DrinkingMethod = string;

/**
 * 在庫（購入記録）から飲酒登録へ引き継ぐ情報。
 * 記録一覧の「これを飲む」から飲酒登録画面へ渡される。
 */
export interface StockDrinkDraft {
  /** 紐づけ先の購入記録 ID */
  purchaseRecordId: string;
  sakeName: string;
  category: SakeCategory;
  /** 引き継いだ時点の飲みきりステータス（未開封なら登録時に飲み中へ更新する） */
  drinkingStatus: DrinkingStatus;
}

/** 在庫から飲む場合の「飲んだ場所」の初期値 */
export const STOCK_DRINK_PLACE_NAME = '自宅';

// 飲み方が不要なカテゴリ（ビール・ワインは飲み方選択不要）
export const CATEGORIES_WITHOUT_DRINKING_METHOD: SakeCategory[] = ['BEER', 'WINE'];

// カテゴリごとの飲み方マッピング
export const DRINKING_METHODS_MAP: Record<SakeCategory, DrinkingMethod[]> = {
  NIHONSHU: ['冷酒', '常温', 'ぬる燗', '熱燗'],
  BEER: [],
  WINE: [],
  WHISKY: ['ストレート', 'ロック', '水割り', 'ハイボール', 'トワイスアップ', 'ミスト', 'その他'],
  SHOCHU: ['ストレート', 'ロック', '水割り', 'お湯割り', 'ソーダ割り'],
  OTHER: [],
};

/**
 * カテゴリに応じた飲み方の選択肢を返す
 * ビール・ワイン・その他は空配列（飲み方選択不要）
 */
export function getDrinkingMethodsByCategory(category: SakeCategory): DrinkingMethod[] {
  return DRINKING_METHODS_MAP[category] ?? [];
}

/**
 * カテゴリが飲み方選択を必要とするかどうかを返す
 */
export function categoryRequiresDrinkingMethod(category: SakeCategory): boolean {
  const methods = DRINKING_METHODS_MAP[category];
  return methods !== undefined && methods.length > 0;
}

// フォームデータの型定義
export interface DrinkingFormData {
  sakeName: string;
  placeName: string;
  price: string;           // 入力時は文字列、送信時にnumber|nullへ変換
  drinkingDate: string;    // YYYY-MM-DD形式
  category: SakeCategory;
  drinkingMethod: string;  // 飲み方不要カテゴリの場合は '-'
  rating: number;          // 1〜5、未選択時は0
  memo: string;
}

// バリデーションエラーの型定義
export interface DrinkingValidationErrors {
  sakeName?: string;
  placeName?: string;
  price?: string;
  drinkingDate?: string;
  category?: string;
  drinkingMethod?: string;
  rating?: string;
}
