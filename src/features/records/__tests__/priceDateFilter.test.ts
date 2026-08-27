// 価格帯・日付範囲フィルタ（Issue #47）。
//
// 日付の既定値（今月・直近3ヶ月・今年）は「今日」に依存するので、
// filterRecords に基準日を渡して固定してある。

import { describe, it, expect } from 'vitest';
import { filterRecords, matchesPriceRange } from '../hooks/useRecordFilter';
import { resolveDateBounds, isValidDateString, toDateString } from '../lib/dateRange';
import { DEFAULT_FILTERS, PRICE_RANGE_OPTIONS, type RecordFilters } from '../types';
import type { UnifiedRecord } from '../types';

function filters(overrides: Partial<RecordFilters> = {}): RecordFilters {
  return { ...DEFAULT_FILTERS, ...overrides };
}

/** 判定に効く項目だけ持たせた記録 */
function record(id: string, price: number | null, date: string): UnifiedRecord {
  return {
    id,
    type: 'purchase',
    sakeName: `酒${id}`,
    price,
    date,
    category: 'NIHONSHU',
    imageKeys: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const ids = (records: UnifiedRecord[]) => records.map((r) => r.id);

describe('価格帯フィルタ', () => {
  const records = [
    record('a', 800, '2026-05-01'),
    record('b', 1000, '2026-05-01'),
    record('c', 2999, '2026-05-01'),
    record('d', 3000, '2026-05-01'),
    record('e', 12000, '2026-05-01'),
    record('none', null, '2026-05-01'),
  ];

  it('すべて を選んでいれば価格では絞らない（未入力も残る）', () => {
    expect(filterRecords(records, filters())).toHaveLength(6);
  });

  it.each([
    ['under-1000' as const, ['a']],
    ['1000-3000' as const, ['b', 'c']],
    ['3000-5000' as const, ['d']],
    ['over-10000' as const, ['e']],
  ])('%s は境界を含めて期待どおりに絞る', (priceRange, expected) => {
    expect(ids(filterRecords(records, filters({ priceRange })))).toEqual(expected);
  });

  it('価格が未入力の記録は、価格帯を選んだ時点で外れる', () => {
    for (const opt of PRICE_RANGE_OPTIONS) {
      if (opt.value === 'all') continue;
      expect(ids(filterRecords(records, filters({ priceRange: opt.value })))).not.toContain(
        'none',
      );
    }
  });

  it('どの価格もちょうど1つの帯に入る（帯が重ならず、隙間もない）', () => {
    const bands = PRICE_RANGE_OPTIONS.filter((opt) => opt.value !== 'all');
    for (const price of [0, 1, 999, 1000, 2999, 3000, 4999, 5000, 9999, 10000, 999999]) {
      const hits = bands.filter((opt) => matchesPriceRange(price, opt.value));
      expect(hits.map((h) => h.value), `${price}円`).toHaveLength(1);
    }
  });

  it('知らない選択肢が来ても絞り込まない（壊れた保存値で一覧を空にしない）', () => {
    expect(matchesPriceRange(1234, '謎の帯' as never)).toBe(true);
  });
});

describe('日付範囲フィルタ', () => {
  // 2026-05-15（金）を「今日」として固定する
  const now = new Date(2026, 4, 15);

  const records = [
    record('2025末', 1000, '2025-12-31'),
    record('今年1月', 1000, '2026-01-15'),
    record('2月', 1000, '2026-02-20'),
    record('今月頭', 1000, '2026-05-01'),
    record('今月末', 1000, '2026-05-31'),
    record('来月', 1000, '2026-06-10'),
  ];

  it('今月 は月初から月末までを含む', () => {
    expect(ids(filterRecords(records, filters({ dateRange: 'this-month' }), now))).toEqual([
      '今月頭',
      '今月末',
    ]);
  });

  it('直近3ヶ月 は3ヶ月前から今日まで（先の日付は含まない）', () => {
    expect(ids(filterRecords(records, filters({ dateRange: 'last-3-months' }), now))).toEqual([
      '2月',
      '今月頭',
    ]);
  });

  it('今年 は1月1日から12月31日まで', () => {
    expect(ids(filterRecords(records, filters({ dateRange: 'this-year' }), now))).toEqual([
      '今年1月',
      '2月',
      '今月頭',
      '今月末',
      '来月',
    ]);
  });

  it('すべて では日付で絞らない', () => {
    expect(filterRecords(records, filters(), now)).toHaveLength(6);
  });

  describe('カスタム範囲', () => {
    it('開始日と終了日の両方を含む', () => {
      const result = filterRecords(
        records,
        filters({
          dateRange: 'custom',
          customDateFrom: '2026-02-20',
          customDateTo: '2026-05-01',
        }),
        now,
      );
      expect(ids(result)).toEqual(['2月', '今月頭']);
    });

    it('開始日だけの指定は「その日以降すべて」になる', () => {
      const result = filterRecords(
        records,
        filters({ dateRange: 'custom', customDateFrom: '2026-05-01' }),
        now,
      );
      expect(ids(result)).toEqual(['今月頭', '今月末', '来月']);
    });

    it('終了日だけの指定は「その日以前すべて」になる', () => {
      const result = filterRecords(
        records,
        filters({ dateRange: 'custom', customDateTo: '2026-01-15' }),
        now,
      );
      expect(ids(result)).toEqual(['2025末', '今年1月']);
    });

    it('日付として壊れている側は指定なし扱いにする', () => {
      const result = filterRecords(
        records,
        filters({
          dateRange: 'custom',
          customDateFrom: '2026-02-31',
          customDateTo: '2026-01-15',
        }),
        now,
      );
      expect(ids(result)).toEqual(['2025末', '今年1月']);
    });

    it('開始日が終了日より後なら1件も出ない', () => {
      const result = filterRecords(
        records,
        filters({
          dateRange: 'custom',
          customDateFrom: '2026-05-01',
          customDateTo: '2026-01-15',
        }),
        now,
      );
      expect(result).toHaveLength(0);
    });
  });
});

describe('resolveDateBounds の月またぎ', () => {
  it('3ヶ月前に同じ日が無ければ、その月の末日に丸める', () => {
    // 5/31 の3ヶ月前は 2/31 になってしまうので 2/28 に寄せる
    expect(resolveDateBounds('last-3-months', '', '', new Date(2026, 4, 31)).from).toBe(
      '2026-02-28',
    );
  });

  it('うるう年では 2/29 に寄せる', () => {
    expect(resolveDateBounds('last-3-months', '', '', new Date(2028, 4, 31)).from).toBe(
      '2028-02-29',
    );
  });

  it('年をまたぐ場合も前年に遡る', () => {
    expect(resolveDateBounds('last-3-months', '', '', new Date(2026, 1, 10))).toEqual({
      from: '2025-11-10',
      to: '2026-02-10',
    });
  });

  it('1月の「今月」は1月末までになる', () => {
    expect(resolveDateBounds('this-month', '', '', new Date(2026, 0, 5))).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
    });
  });
});

describe('日付文字列の検証', () => {
  it.each(['2026-01-01', '2026-12-31', '2028-02-29'])('%s は妥当', (value) => {
    expect(isValidDateString(value)).toBe(true);
  });

  it.each(['2026-02-31', '2026-13-01', '2026-1-1', '20260101', '', 'abc', 42, null, undefined])(
    '%s は妥当でない',
    (value) => {
      expect(isValidDateString(value)).toBe(false);
    },
  );

  it('ローカル時刻基準で日付にする（UTC 変換で1日ずれない）', () => {
    expect(toDateString(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
    expect(toDateString(new Date(2026, 11, 31, 23, 30))).toBe('2026-12-31');
  });
});
