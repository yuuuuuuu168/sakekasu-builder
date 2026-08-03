import { describe, it, expect } from 'vitest';
import {
  unifiedToPurchaseFormData,
  unifiedToDrinkingFormData,
} from '../lib/recordToFormData';
import type { UnifiedRecord } from '../types';

const basePurchase: UnifiedRecord = {
  id: 'p1',
  type: 'purchase',
  sakeName: '獺祭 純米大吟醸',
  price: 3300,
  date: '2026-01-15',
  category: 'NIHONSHU',
  memo: '美味しかった',
  storeName: '酒のやまや',
  quantity: 3,
  drinkingStatus: 'NOT_STARTED',
  imageKeys: ['k1'],
  createdAt: '2026-01-15T00:00:00Z',
  updatedAt: '2026-01-15T00:00:00Z',
};

const baseDrinking: UnifiedRecord = {
  id: 'd1',
  type: 'drinking',
  sakeName: '白州',
  price: 1200,
  date: '2026-02-20',
  category: 'WHISKY',
  memo: 'ロックで',
  placeName: 'BAR 花',
  drinkingMethod: 'ロック',
  rating: 4,
  imageKeys: [],
  createdAt: '2026-02-20T00:00:00Z',
  updatedAt: '2026-02-20T00:00:00Z',
};

describe('unifiedToPurchaseFormData', () => {
  it('購入記録をフォーム入力値に変換する（priceは文字列化）', () => {
    expect(unifiedToPurchaseFormData(basePurchase)).toEqual({
      sakeName: '獺祭 純米大吟醸',
      storeName: '酒のやまや',
      price: '3300',
      quantity: '3',
      purchaseDate: '2026-01-15',
      category: 'NIHONSHU',
      memo: '美味しかった',
    });
  });

  it('price/memo/storeName/quantity が未設定なら既定値にフォールバックする', () => {
    const record: UnifiedRecord = {
      ...basePurchase,
      price: null,
      memo: undefined,
      storeName: undefined,
      quantity: undefined,
    };
    const result = unifiedToPurchaseFormData(record);
    expect(result.price).toBe('');
    expect(result.memo).toBe('');
    expect(result.storeName).toBe('');
    // 本数は未設定でも 1 にフォールバック
    expect(result.quantity).toBe('1');
  });
});

describe('unifiedToDrinkingFormData', () => {
  it('飲酒記録をフォーム入力値に変換する', () => {
    expect(unifiedToDrinkingFormData(baseDrinking)).toEqual({
      sakeName: '白州',
      placeName: 'BAR 花',
      price: '1200',
      drinkingDate: '2026-02-20',
      category: 'WHISKY',
      drinkingMethod: 'ロック',
      rating: 4,
      memo: 'ロックで',
    });
  });

  it('price/rating/drinkingMethod/memo/placeName が未設定なら既定値にフォールバックする', () => {
    const record: UnifiedRecord = {
      ...baseDrinking,
      price: null,
      rating: undefined,
      drinkingMethod: undefined,
      memo: undefined,
      placeName: undefined,
    };
    const result = unifiedToDrinkingFormData(record);
    expect(result.price).toBe('');
    expect(result.rating).toBe(0);
    expect(result.drinkingMethod).toBe('');
    expect(result.memo).toBe('');
    expect(result.placeName).toBe('');
  });
});
