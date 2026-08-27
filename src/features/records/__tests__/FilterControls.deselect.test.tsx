// 絞り込みの選択を解除したときの振る舞い。
//
// base-ui の Select は、選ばれている項目をもう一度押すと解除として null を
// 渡してくる。そのまま絞り込みへ入れると、どの条件にも一致しなくなって
// 記録が1件も出なくなる（`filters.recordType === 'all'` も
// `record.type === filters.recordType` も false になるため）。
//
// 画面はリロードすれば直る（filterStorage が保存時に値を検査する）が、
// 操作している間ずっと空に見えるので、解除は「操作なし」として扱う。

import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';

import { FilterControls } from '../components/FilterControls';
import { filterRecords } from '../hooks/useRecordFilter';
import type { RecordFilters, UnifiedRecord } from '../types';

/** onValueChange に渡された関数を、Select ごとに集める */
const handlers: ((value: string | null) => void)[] = [];

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    onValueChange,
  }: {
    children: React.ReactNode;
    onValueChange?: (value: string | null) => void;
  }) => {
    if (onValueChange) handlers.push(onValueChange);
    return <div>{children}</div>;
  },
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const noop = vi.fn();

// 詳細フィルタは畳まれていると描画されないので、条件を1つ入れて開いた状態にする。
// 解除のガードは常時出る条件にも詳細側にも要るため、両方を一度に見る
function renderControls() {
  handlers.length = 0;
  const onChange = {
    onRecordTypeChange: vi.fn(),
    onCategoryChange: vi.fn(),
    onDrinkingStatusChange: vi.fn(),
    onRatingChange: vi.fn(),
    onPriceRangeChange: vi.fn(),
    onDateRangeChange: vi.fn(),
    onSortChange: vi.fn(),
  };

  render(
    <FilterControls
      recordType="all"
      category="all"
      searchQuery=""
      sortOption="date-desc"
      drinkingStatusFilter="all"
      ratingFilter={4}
      priceRangeFilter="all"
      dateRangeFilter="all"
      customDateFrom=""
      customDateTo=""
      hasActiveFilter={false}
      onSearchQueryChange={noop}
      onCustomDateFromChange={noop}
      onCustomDateToChange={noop}
      onReset={noop}
      {...onChange}
    />,
  );

  return onChange;
}

describe('絞り込みの選択解除', () => {
  it('解除（null）ではどのハンドラも呼ばない', () => {
    const onChange = renderControls();

    expect(handlers.length).toBeGreaterThan(0);
    handlers.forEach((handler) => handler(null));

    for (const [name, fn] of Object.entries(onChange)) {
      expect(fn, `${name} が解除で呼ばれている`).not.toHaveBeenCalled();
    }
  });

  it('値を選んだときは従来どおり通知する', () => {
    const onChange = renderControls();

    handlers.forEach((handler) => handler('all'));

    // すべての Select が何かしら通知している（解除だけを弾いている）
    const called = Object.values(onChange).filter((fn) => fn.mock.calls.length > 0);
    expect(called.length).toBe(handlers.length);
  });
});

// 解除を素通しするとどうなるかを、絞り込み側から見て固定しておく。
// ここが 0 件になるのが、ガードを入れている理由そのもの
describe('絞り込みに null が入った場合', () => {
  const records = [
    { id: '1', type: 'purchase', sakeName: '山崎', category: 'WHISKY', date: '2026-01-01', imageKeys: [] },
    { id: '2', type: 'drinking', sakeName: '獺祭', category: 'NIHONSHU', date: '2026-01-02', imageKeys: [] },
  ] as unknown as UnifiedRecord[];

  const base = {
    recordType: 'all',
    category: 'all',
    searchQuery: '',
    drinkingStatus: 'all',
    rating: 'all',
    priceRange: 'all',
    dateRange: 'all',
    customDateFrom: '',
    customDateTo: '',
  } as unknown as RecordFilters;

  it('正常な絞り込みでは全件出る', () => {
    expect(filterRecords(records, base)).toHaveLength(2);
  });

  // 価格帯・日付範囲は、知らない値が来ても絞り込まない側に倒してある。
  // 記録種別などと違い、壊れた保存値で一覧が空になることはない
  it.each(['priceRange', 'dateRange'])('%s が null でも全件出る', (field) => {
    const broken = { ...base, [field]: null } as unknown as RecordFilters;
    expect(filterRecords(records, broken)).toHaveLength(2);
  });

  it.each(['recordType', 'category', 'drinkingStatus'])(
    '%s が null だと1件も出なくなる',
    (field) => {
      const broken = { ...base, [field]: null } as unknown as RecordFilters;
      expect(filterRecords(records, broken)).toHaveLength(0);
    },
  );
});
