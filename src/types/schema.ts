/**
 * CDK バックエンド用スキーマ型定義
 *
 * Amplify Gen 2 の ClientSchema<typeof schema> に相当する型を
 * 独立して定義する。amplify/ ディレクトリ削除後もフロントエンドの
 * generateClient<Schema>() が型安全に動作するようにする。
 */

import type { SakeCategory } from '@/features/purchase/types';

// 飲みきりステータス
export type DrinkingStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED';

// 各モデルの共通フィールド
interface BaseRecord {
  id: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
}

// PurchaseRecord モデル型
export interface PurchaseRecordType extends BaseRecord {
  sakeName: string;
  storeName: string;
  price: number;
  quantity: number | null;
  /**
   * まだ飲みきっていない本数（Issue #159）。
   * この項目より前に作った記録では null になるので、読むときは quantity で補完する。
   */
  remainingQuantity: number | null;
  purchaseDate: string;
  category: SakeCategory;
  memo: string | null;
  imageKey: string | null;
  imageKeys: string[] | null;
  drinkingStatus: DrinkingStatus | null;
  openedAt: string | null;
}

// DrinkingRecord モデル型
export interface DrinkingRecordType extends BaseRecord {
  sakeName: string;
  placeName: string;
  price: number | null;
  drinkingDate: string;
  category: SakeCategory;
  drinkingMethod: string;
  rating: number;
  memo: string | null;
  imageKey: string | null;
  imageKeys: string[] | null;
  /** 在庫（購入記録）から登録した場合の紐づけ先。手入力の記録では null */
  purchaseRecordId: string | null;
}

// ページネーション対応の一覧レスポンス型
export interface PurchaseRecordConnection {
  items: PurchaseRecordType[];
  nextToken: string | null;
}

export interface DrinkingRecordConnection {
  items: DrinkingRecordType[];
  nextToken: string | null;
}

// Amplify generateClient<Schema>() 互換の Schema 型
export type Schema = {
  PurchaseRecord: {
    type: PurchaseRecordType;
  };
  DrinkingRecord: {
    type: DrinkingRecordType;
  };
};
