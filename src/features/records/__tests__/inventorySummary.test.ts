import { describe, it, expect } from 'vitest';
import { summarizeInventory } from '../lib/inventorySummary';
import type { UnifiedRecord } from '../types';
import type { SakeCategory } from '@/features/purchase/types';
import type { DrinkingStatus } from '@/types/schema';

function purchase(
  overrides: {
    id?: string;
    category?: SakeCategory;
    quantity?: number;
    drinkingStatus?: DrinkingStatus;
  } = {},
): UnifiedRecord {
  return {
    id: overrides.id ?? 'p-1',
    type: 'purchase',
    sakeName: '獺祭',
    price: 3000,
    date: '2026-01-10',
    category: overrides.category ?? 'NIHONSHU',
    storeName: '酒屋',
    quantity: overrides.quantity,
    drinkingStatus: overrides.drinkingStatus,
    imageKeys: [],
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
  };
}

function drinking(category: SakeCategory = 'NIHONSHU'): UnifiedRecord {
  return {
    id: 'd-1',
    type: 'drinking',
    sakeName: '獺祭',
    price: 800,
    date: '2026-01-11',
    category,
    placeName: '自宅',
    drinkingMethod: '冷酒',
    rating: 4,
    imageKeys: [],
    createdAt: '2026-01-11T00:00:00.000Z',
    updatedAt: '2026-01-11T00:00:00.000Z',
  };
}

/** カテゴリ別の結果を引く */
function pick(records: UnifiedRecord[], category: SakeCategory) {
  const summary = summarizeInventory(records).find((s) => s.category === category);
  if (!summary) throw new Error(`summary not found: ${category}`);
  return summary;
}

describe('summarizeInventory', () => {
  it('対象はウイスキーと日本酒の2カテゴリのみ', () => {
    const result = summarizeInventory([]);
    expect(result.map((s) => s.category)).toEqual(['WHISKY', 'NIHONSHU']);
    expect(result.map((s) => s.label)).toEqual(['ウイスキー', '日本酒']);
  });

  it('未開封と飲み中を合算し、内訳も返す', () => {
    const records = [
      purchase({ id: 'p-1', quantity: 2, drinkingStatus: 'NOT_STARTED' }),
      purchase({ id: 'p-2', quantity: 1, drinkingStatus: 'IN_PROGRESS' }),
    ];

    const nihonshu = pick(records, 'NIHONSHU');
    expect(nihonshu.total).toBe(3);
    expect(nihonshu.notStarted).toBe(2);
    expect(nihonshu.inProgress).toBe(1);
  });

  it('飲みきりは在庫に数えない', () => {
    const records = [
      purchase({ id: 'p-1', quantity: 3, drinkingStatus: 'FINISHED' }),
      purchase({ id: 'p-2', quantity: 1, drinkingStatus: 'NOT_STARTED' }),
    ];

    expect(pick(records, 'NIHONSHU').total).toBe(1);
  });

  it('ステータス未設定の記録は未開封として数える', () => {
    const records = [purchase({ quantity: 2, drinkingStatus: undefined })];

    const nihonshu = pick(records, 'NIHONSHU');
    expect(nihonshu.total).toBe(2);
    expect(nihonshu.notStarted).toBe(2);
  });

  it('本数が未設定なら1本として数える', () => {
    expect(pick([purchase({ quantity: undefined })], 'NIHONSHU').total).toBe(1);
  });

  it('飲酒記録と対象外カテゴリは数えない', () => {
    const records = [
      drinking('NIHONSHU'),
      purchase({ id: 'p-1', category: 'BEER', quantity: 6 }),
      purchase({ id: 'p-2', category: 'WHISKY', quantity: 1 }),
    ];

    expect(pick(records, 'NIHONSHU').total).toBe(0);
    expect(pick(records, 'WHISKY').total).toBe(1);
  });
});
