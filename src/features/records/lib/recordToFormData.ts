import type { UnifiedRecord } from '../types';
import type { PurchaseFormData } from '@/features/purchase/types';
import type { DrinkingFormData } from '@/features/drinking/types';

/** 統合記録（購入）を購入フォームの入力値に変換する */
export function unifiedToPurchaseFormData(record: UnifiedRecord): PurchaseFormData {
  return {
    sakeName: record.sakeName,
    storeName: record.storeName ?? '',
    price: record.price != null ? String(record.price) : '',
    quantity: record.quantity != null ? String(record.quantity) : '1',
    purchaseDate: record.date,
    category: record.category,
    memo: record.memo ?? '',
  };
}

/** 統合記録（飲酒）を飲酒フォームの入力値に変換する */
export function unifiedToDrinkingFormData(record: UnifiedRecord): DrinkingFormData {
  return {
    sakeName: record.sakeName,
    placeName: record.placeName ?? '',
    price: record.price != null ? String(record.price) : '',
    drinkingDate: record.date,
    category: record.category,
    drinkingMethod: record.drinkingMethod ?? '',
    rating: record.rating ?? 0,
    memo: record.memo ?? '',
  };
}
