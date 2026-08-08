import { describe, it, expect } from 'vitest';
import {
  parseDateKey,
  formatDateKey,
  groupRecordsByDate,
  collectMarkedDates,
  countMonthlyRecordDays,
} from '../lib/aggregate';
import type { UnifiedRecord } from '@/features/records/types';

function makeRecord(overrides: Partial<UnifiedRecord> & Pick<UnifiedRecord, 'id' | 'type' | 'date'>): UnifiedRecord {
  return {
    sakeName: 'テスト酒',
    price: null,
    category: 'NIHONSHU',
    imageKeys: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('parseDateKey / formatDateKey', () => {
  it('YYYY-MM-DD をローカルタイムの Date として解釈し、往復変換で同じ文字列に戻る', () => {
    const date = parseDateKey('2026-08-08');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(7);
    expect(date.getDate()).toBe(8);
    expect(formatDateKey(date)).toBe('2026-08-08');
  });
});

describe('groupRecordsByDate', () => {
  it('同じ日付の記録が同じキーにまとまる', () => {
    const records = [
      makeRecord({ id: '1', type: 'purchase', date: '2026-08-01' }),
      makeRecord({ id: '2', type: 'drinking', date: '2026-08-01' }),
      makeRecord({ id: '3', type: 'drinking', date: '2026-08-02' }),
    ];

    const grouped = groupRecordsByDate(records);

    expect(grouped.get('2026-08-01')?.map((r) => r.id)).toEqual(['1', '2']);
    expect(grouped.get('2026-08-02')?.map((r) => r.id)).toEqual(['3']);
    expect(grouped.get('2026-08-03')).toBeUndefined();
  });
});

describe('collectMarkedDates', () => {
  it('購入と飲酒を種別ごとに分け、同日の重複は1つにまとめる', () => {
    const records = [
      makeRecord({ id: '1', type: 'purchase', date: '2026-08-01' }),
      makeRecord({ id: '2', type: 'purchase', date: '2026-08-01' }),
      makeRecord({ id: '3', type: 'drinking', date: '2026-08-01' }),
      makeRecord({ id: '4', type: 'drinking', date: '2026-08-05' }),
    ];

    const { purchased, drank } = collectMarkedDates(records);

    expect(purchased.map(formatDateKey)).toEqual(['2026-08-01']);
    expect(drank.map(formatDateKey).sort()).toEqual(['2026-08-01', '2026-08-05']);
  });
});

describe('countMonthlyRecordDays', () => {
  it('指定月のユニーク日数を数え、他の月の記録は含めない', () => {
    const records = [
      makeRecord({ id: '1', type: 'drinking', date: '2026-08-01' }),
      makeRecord({ id: '2', type: 'drinking', date: '2026-08-01' }), // 同日2件 → 1日と数える
      makeRecord({ id: '3', type: 'drinking', date: '2026-08-15' }),
      makeRecord({ id: '4', type: 'drinking', date: '2026-07-31' }), // 前月 → 対象外
      makeRecord({ id: '5', type: 'purchase', date: '2026-08-08' }),
    ];

    const result = countMonthlyRecordDays(records, parseDateKey('2026-08-01'));

    expect(result.drinkingDays).toBe(2);
    expect(result.purchaseDays).toBe(1);
  });

  it('記録がなければどちらも0', () => {
    const result = countMonthlyRecordDays([], parseDateKey('2026-08-01'));
    expect(result).toEqual({ drinkingDays: 0, purchaseDays: 0 });
  });
});
