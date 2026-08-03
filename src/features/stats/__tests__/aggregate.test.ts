import { describe, it, expect } from 'vitest';
import {
  aggregateMonthlyDrinking,
  aggregateCategorySpending,
  aggregateTopSakes,
} from '../lib/aggregate';
import type { UnifiedRecord } from '@/features/records/types';

// --- テストデータ生成ヘルパー ---

let seq = 0;

function makePurchase(overrides: Partial<UnifiedRecord> = {}): UnifiedRecord {
  seq += 1;
  return {
    id: `purchase-${seq}`,
    type: 'purchase',
    sakeName: '獺祭',
    price: 3000,
    date: '2026-08-01',
    category: 'NIHONSHU',
    storeName: '酒屋',
    imageKeys: [],
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

function makeDrinking(overrides: Partial<UnifiedRecord> = {}): UnifiedRecord {
  seq += 1;
  return {
    id: `drinking-${seq}`,
    type: 'drinking',
    sakeName: '獺祭',
    price: null,
    date: '2026-08-01',
    category: 'NIHONSHU',
    placeName: '自宅',
    drinkingMethod: '冷酒',
    rating: 4,
    imageKeys: [],
    createdAt: '2026-08-01T20:00:00.000Z',
    updatedAt: '2026-08-01T20:00:00.000Z',
    ...overrides,
  };
}

// 基準日: 2026-08-15
const NOW = new Date(2026, 7, 15);

// --- 月別飲酒量 ---

describe('aggregateMonthlyDrinking', () => {
  it('直近6ヶ月分のバケットが古い月から順に生成される', () => {
    const result = aggregateMonthlyDrinking([], NOW);
    expect(result.map((r) => r.yearMonth)).toEqual([
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
    ]);
    expect(result.map((r) => r.label)).toEqual(['3月', '4月', '5月', '6月', '7月', '8月']);
    expect(result.every((r) => r.count === 0)).toBe(true);
  });

  it('飲酒記録が該当する月にカウントされる', () => {
    const records = [
      makeDrinking({ date: '2026-08-01' }),
      makeDrinking({ date: '2026-08-14' }),
      makeDrinking({ date: '2026-06-30' }),
    ];
    const result = aggregateMonthlyDrinking(records, NOW);
    expect(result.find((r) => r.yearMonth === '2026-08')?.count).toBe(2);
    expect(result.find((r) => r.yearMonth === '2026-06')?.count).toBe(1);
  });

  it('期間外の記録と購入記録はカウントされない', () => {
    const records = [
      makeDrinking({ date: '2026-02-28' }), // 6ヶ月より前
      makeDrinking({ date: '2025-08-15' }), // 前年の同月
      makePurchase({ date: '2026-08-01' }), // 購入記録
    ];
    const result = aggregateMonthlyDrinking(records, NOW);
    expect(result.every((r) => r.count === 0)).toBe(true);
  });

  it('年をまたぐ期間でも正しくバケットが生成される', () => {
    const result = aggregateMonthlyDrinking([], new Date(2026, 1, 10)); // 2026-02 基準
    expect(result.map((r) => r.yearMonth)).toEqual([
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });
});

// --- カテゴリ別支出 ---

describe('aggregateCategorySpending', () => {
  it('購入記録の価格がカテゴリ別に合計され金額の大きい順に並ぶ', () => {
    const records = [
      makePurchase({ category: 'NIHONSHU', price: 3000 }),
      makePurchase({ category: 'NIHONSHU', price: 2000 }),
      makePurchase({ category: 'BEER', price: 500 }),
      makePurchase({ category: 'WINE', price: 8000 }),
    ];
    const result = aggregateCategorySpending(records);
    expect(result).toEqual([
      { category: 'WINE', label: 'ワイン', amount: 8000 },
      { category: 'NIHONSHU', label: '日本酒', amount: 5000 },
      { category: 'BEER', label: 'ビール', amount: 500 },
    ]);
  });

  it('飲酒記録の価格は集計されない', () => {
    const records = [makeDrinking({ price: 1500, category: 'WHISKY' })];
    expect(aggregateCategorySpending(records)).toEqual([]);
  });

  it('記録がない場合は空配列を返す', () => {
    expect(aggregateCategorySpending([])).toEqual([]);
  });
});

// --- お気に入り銘柄 TOP5 ---

describe('aggregateTopSakes', () => {
  it('銘柄ごとの平均評価が高い順に返される', () => {
    const records = [
      makeDrinking({ sakeName: '獺祭', rating: 5 }),
      makeDrinking({ sakeName: '獺祭', rating: 3 }),
      makeDrinking({ sakeName: '八海山', rating: 5 }),
      makeDrinking({ sakeName: '久保田', rating: 2 }),
    ];
    const result = aggregateTopSakes(records);
    expect(result.map((r) => r.sakeName)).toEqual(['八海山', '獺祭', '久保田']);
    expect(result[0]).toMatchObject({ sakeName: '八海山', avgRating: 5, count: 1 });
    expect(result[1]).toMatchObject({ sakeName: '獺祭', avgRating: 4, count: 2 });
  });

  it('平均評価が同じ場合は飲んだ回数が多い順になる', () => {
    const records = [
      makeDrinking({ sakeName: '一回だけ', rating: 4 }),
      makeDrinking({ sakeName: '二回飲んだ', rating: 4 }),
      makeDrinking({ sakeName: '二回飲んだ', rating: 4 }),
    ];
    const result = aggregateTopSakes(records);
    expect(result.map((r) => r.sakeName)).toEqual(['二回飲んだ', '一回だけ']);
  });

  it('上位5件までに制限される', () => {
    const records = Array.from({ length: 7 }, (_, i) =>
      makeDrinking({ sakeName: `銘柄${i}`, rating: 3 }),
    );
    expect(aggregateTopSakes(records)).toHaveLength(5);
  });

  it('購入記録と評価なしの記録は対象外', () => {
    const records = [
      makePurchase({ sakeName: '購入のみ' }),
      makeDrinking({ sakeName: '評価なし', rating: 0 }),
    ];
    expect(aggregateTopSakes(records)).toEqual([]);
  });
});
