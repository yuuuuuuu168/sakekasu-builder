import { describe, it, expect } from 'vitest';
import { buildLinkedDrinkingIndex } from '../lib/linkedDrinking';
import type { UnifiedRecord } from '../types';

function drinking(overrides: Partial<UnifiedRecord> & { id: string }): UnifiedRecord {
  return {
    type: 'drinking',
    sakeName: '獺祭',
    price: 800,
    date: '2026-01-11',
    category: 'NIHONSHU',
    placeName: '自宅',
    drinkingMethod: '冷酒',
    rating: 4,
    imageKeys: [],
    createdAt: '2026-01-11T00:00:00.000Z',
    updatedAt: '2026-01-11T00:00:00.000Z',
    ...overrides,
  };
}

const purchaseRecord: UnifiedRecord = {
  id: 'p-1',
  type: 'purchase',
  sakeName: '獺祭',
  price: 3000,
  date: '2026-01-10',
  category: 'NIHONSHU',
  storeName: '酒屋',
  quantity: 1,
  drinkingStatus: 'IN_PROGRESS',
  imageKeys: [],
  createdAt: '2026-01-10T00:00:00.000Z',
  updatedAt: '2026-01-10T00:00:00.000Z',
};

describe('buildLinkedDrinkingIndex', () => {
  it('紐づけのない記録は索引に入らない', () => {
    const index = buildLinkedDrinkingIndex([
      purchaseRecord,
      drinking({ id: 'd-1', purchaseRecordId: null }),
      drinking({ id: 'd-2' }),
    ]);

    expect(index.size).toBe(0);
  });

  it('件数と平均評価を集計する', () => {
    const index = buildLinkedDrinkingIndex([
      purchaseRecord,
      drinking({ id: 'd-1', purchaseRecordId: 'p-1', rating: 4 }),
      drinking({ id: 'd-2', purchaseRecordId: 'p-1', rating: 5 }),
    ]);

    const summary = index.get('p-1');
    expect(summary?.count).toBe(2);
    expect(summary?.averageRating).toBe(4.5);
  });

  it('評価が未入力（0）の記録は平均に含めない', () => {
    const index = buildLinkedDrinkingIndex([
      drinking({ id: 'd-1', purchaseRecordId: 'p-1', rating: 0 }),
      drinking({ id: 'd-2', purchaseRecordId: 'p-1', rating: 3 }),
    ]);

    expect(index.get('p-1')?.averageRating).toBe(3);
  });

  it('評価がすべて未入力なら平均は null', () => {
    const index = buildLinkedDrinkingIndex([
      drinking({ id: 'd-1', purchaseRecordId: 'p-1', rating: 0 }),
    ]);

    expect(index.get('p-1')?.averageRating).toBeNull();
  });

  it('最新の記録のメモと日付を採用する', () => {
    const index = buildLinkedDrinkingIndex([
      drinking({ id: 'd-1', purchaseRecordId: 'p-1', date: '2026-01-11', memo: '古い' }),
      drinking({ id: 'd-2', purchaseRecordId: 'p-1', date: '2026-02-20', memo: '新しい' }),
    ]);

    const summary = index.get('p-1');
    expect(summary?.latestMemo).toBe('新しい');
    expect(summary?.latestDate).toBe('2026-02-20');
  });

  it('同じ日なら作成日時が新しい方を採用する', () => {
    const index = buildLinkedDrinkingIndex([
      drinking({
        id: 'd-1',
        purchaseRecordId: 'p-1',
        date: '2026-01-11',
        memo: '先',
        createdAt: '2026-01-11T10:00:00.000Z',
      }),
      drinking({
        id: 'd-2',
        purchaseRecordId: 'p-1',
        date: '2026-01-11',
        memo: '後',
        createdAt: '2026-01-11T22:00:00.000Z',
      }),
    ]);

    expect(index.get('p-1')?.latestMemo).toBe('後');
  });

  it('購入記録ごとに独立して集計する', () => {
    const index = buildLinkedDrinkingIndex([
      drinking({ id: 'd-1', purchaseRecordId: 'p-1', rating: 5 }),
      drinking({ id: 'd-2', purchaseRecordId: 'p-2', rating: 2 }),
    ]);

    expect(index.get('p-1')?.count).toBe(1);
    expect(index.get('p-2')?.averageRating).toBe(2);
  });
});
