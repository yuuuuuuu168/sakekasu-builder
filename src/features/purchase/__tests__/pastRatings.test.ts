import { describe, it, expect } from 'vitest';
import { findPastRatings, normalizeSakeName } from '../lib/pastRatings';
import type { DrinkingRecordType } from '@/types/schema';

let seq = 0;

function makeDrinking(overrides: Partial<DrinkingRecordType> = {}): DrinkingRecordType {
  seq += 1;
  return {
    id: `drinking-${seq}`,
    owner: 'user-1',
    sakeName: '獺祭 純米大吟醸',
    placeName: '自宅',
    price: null,
    drinkingDate: '2026-07-01',
    category: 'NIHONSHU',
    drinkingMethod: '冷酒',
    rating: 4,
    memo: null,
    imageKey: null,
    imageKeys: null,
    createdAt: '2026-07-01T20:00:00.000Z',
    updatedAt: '2026-07-01T20:00:00.000Z',
    ...overrides,
  };
}

describe('normalizeSakeName', () => {
  it('全角/半角・大文字小文字・空白の違いを吸収する', () => {
    expect(normalizeSakeName('獺祭　純米大吟醸')).toBe(normalizeSakeName('獺祭 純米大吟醸'));
    expect(normalizeSakeName('ＹＫ３５')).toBe(normalizeSakeName('yk35'));
    expect(normalizeSakeName('  獺祭  ')).toBe('獺祭');
  });
});

describe('findPastRatings', () => {
  it('部分一致した銘柄の平均評価・回数・最終飲酒日が返される', () => {
    const records = [
      makeDrinking({ sakeName: '獺祭 純米大吟醸', rating: 5, drinkingDate: '2026-05-01' }),
      makeDrinking({ sakeName: '獺祭 純米大吟醸', rating: 3, drinkingDate: '2026-07-15' }),
    ];
    const result = findPastRatings(records, '獺祭');
    expect(result).toEqual([
      { sakeName: '獺祭 純米大吟醸', avgRating: 4, count: 2, lastDate: '2026-07-15' },
    ]);
  });

  it('入力が記録名より長い場合（入力が記録名を含む）もマッチする', () => {
    const records = [makeDrinking({ sakeName: '八海山', rating: 4 })];
    expect(findPastRatings(records, '八海山 特別本醸造')).toHaveLength(1);
  });

  it('空白や全角/半角の表記ゆれがあってもマッチする', () => {
    const records = [makeDrinking({ sakeName: '獺祭　純米大吟醸', rating: 4 })];
    expect(findPastRatings(records, '獺祭 純米大吟醸')).toHaveLength(1);
  });

  it('表記ゆれのある同一銘柄が1つのサマリに集計される（分裂しない）', () => {
    const records = [
      makeDrinking({ sakeName: '獺祭 純米大吟醸', rating: 5, drinkingDate: '2026-06-01' }),
      makeDrinking({ sakeName: '獺祭　純米大吟醸', rating: 3, drinkingDate: '2026-07-01' }),
    ];
    const result = findPastRatings(records, '獺祭');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ avgRating: 4, count: 2, lastDate: '2026-07-01' });
  });

  it('2文字未満の入力では検索しない', () => {
    const records = [makeDrinking({ sakeName: '獺', rating: 5 })];
    expect(findPastRatings(records, '獺')).toEqual([]);
    expect(findPastRatings(records, '')).toEqual([]);
  });

  it('マッチしない銘柄は返されない', () => {
    const records = [makeDrinking({ sakeName: '八海山', rating: 4 })];
    expect(findPastRatings(records, '久保田')).toEqual([]);
  });

  it('評価のない記録（rating 0）は対象外', () => {
    const records = [makeDrinking({ sakeName: '獺祭', rating: 0 })];
    expect(findPastRatings(records, '獺祭')).toEqual([]);
  });

  it('完全一致する銘柄が部分一致より先頭に来る', () => {
    const records = [
      makeDrinking({ sakeName: '獺祭 純米大吟醸', rating: 5 }),
      makeDrinking({ sakeName: '獺祭 純米大吟醸', rating: 5 }),
      makeDrinking({ sakeName: '獺祭', rating: 3 }),
    ];
    const result = findPastRatings(records, '獺祭');
    expect(result[0].sakeName).toBe('獺祭');
  });

  it('上位3件までに制限される', () => {
    const records = Array.from({ length: 5 }, (_, i) =>
      makeDrinking({ sakeName: `獺祭 その${i}`, rating: 3 }),
    );
    expect(findPastRatings(records, '獺祭')).toHaveLength(3);
  });
});
