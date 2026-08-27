// カスタム範囲の日付入力まわり（Issue #47）。
//
// 画面側は「custom を選んだときだけ開始日・終了日を出す」だけだが、
// 出しっぱなしにすると、期間を選び直したあとも見えない条件が残る。
// フックが選び直しで両端を空へ戻すところまで合わせて固定しておく。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { renderHook } from '@testing-library/react';

// base-ui の Select は jsdom で開けないので、値の受け渡しだけを模す。
// トリガーは data-testid を載せている側なので、属性をそのまま通す
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children, ...props }: { children: React.ReactNode }) => (
    <div {...props}>{children}</div>
  ),
  SelectValue: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockUseRecordFetch = vi.fn();
vi.mock('../hooks/useRecordFetch', () => ({
  useRecordFetch: () => mockUseRecordFetch(),
}));

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'user-1' } }),
}));

import { FilterControls } from '../components/FilterControls';
import { useRecordList } from '../hooks/useRecordList';
import type {
  DateRangeFilter,
  RatingFilter,
  PriceRangeFilter,
  DrinkingStatusFilter,
} from '../types';

const noop = vi.fn();

function renderControls(overrides: {
  dateRangeFilter?: DateRangeFilter;
  customDateFrom?: string;
  customDateTo?: string;
  ratingFilter?: RatingFilter;
  priceRangeFilter?: PriceRangeFilter;
  drinkingStatusFilter?: DrinkingStatusFilter;
} = {}) {
  render(
    <FilterControls
      recordType="all"
      category="all"
      searchQuery=""
      sortOption="date-desc"
      drinkingStatusFilter="all"
      ratingFilter="all"
      priceRangeFilter="all"
      dateRangeFilter="all"
      customDateFrom=""
      customDateTo=""
      hasActiveFilter={false}
      onRecordTypeChange={noop}
      onCategoryChange={noop}
      onSearchQueryChange={noop}
      onSortChange={noop}
      onDrinkingStatusChange={noop}
      onRatingChange={noop}
      onPriceRangeChange={noop}
      onDateRangeChange={noop}
      onCustomDateFromChange={noop}
      onCustomDateToChange={noop}
      onReset={noop}
      {...overrides}
    />,
  );
}

describe('カスタム範囲の日付入力', () => {
  it.each<DateRangeFilter>(['all', 'this-month', 'last-3-months', 'this-year'])(
    '%s では出さない',
    (dateRangeFilter) => {
      renderControls({ dateRangeFilter });
      expect(screen.queryByTestId('filter-date-from')).not.toBeInTheDocument();
      expect(screen.queryByTestId('filter-date-to')).not.toBeInTheDocument();
    },
  );

  it('custom を選んだときだけ開始日・終了日を出す', () => {
    renderControls({ dateRangeFilter: 'custom' });
    expect(screen.getByTestId('filter-date-from')).toBeInTheDocument();
    expect(screen.getByTestId('filter-date-to')).toBeInTheDocument();
  });

  it('逆転した範囲を選べないよう、互いの値を上限・下限に渡す', () => {
    renderControls({
      dateRangeFilter: 'custom',
      customDateFrom: '2026-01-01',
      customDateTo: '2026-03-31',
    });

    expect(screen.getByTestId('filter-date-from')).toHaveAttribute('max', '2026-03-31');
    expect(screen.getByTestId('filter-date-to')).toHaveAttribute('min', '2026-01-01');
  });

  it('片側が空なら、もう片側に上限・下限を付けない', () => {
    renderControls({ dateRangeFilter: 'custom', customDateFrom: '2026-01-01' });

    expect(screen.getByTestId('filter-date-from')).not.toHaveAttribute('max');
    expect(screen.getByTestId('filter-date-to')).toHaveAttribute('min', '2026-01-01');
  });
});

describe('日付範囲を選び直したときの状態', () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseRecordFetch.mockReturnValue({
      records: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it('custom から他の期間へ移ると、入力してあった日付を空に戻す', () => {
    const { result } = renderHook(() => useRecordList());

    act(() => {
      result.current.setDateRangeFilter('custom');
    });
    act(() => {
      result.current.setCustomDateFrom('2026-01-01');
      result.current.setCustomDateTo('2026-03-31');
    });

    expect(result.current.customDateFrom).toBe('2026-01-01');
    expect(result.current.customDateTo).toBe('2026-03-31');

    act(() => {
      result.current.setDateRangeFilter('this-month');
    });

    expect(result.current.customDateFrom).toBe('');
    expect(result.current.customDateTo).toBe('');
  });

  it('日付範囲・価格帯を選ぶと絞り込み中と見なす（リセットが出る）', () => {
    const { result } = renderHook(() => useRecordList());
    expect(result.current.hasActiveFilter).toBe(false);

    act(() => {
      result.current.setPriceRangeFilter('3000-5000');
    });
    expect(result.current.hasActiveFilter).toBe(true);

    act(() => {
      result.current.resetFilters();
    });
    expect(result.current.hasActiveFilter).toBe(false);

    act(() => {
      result.current.setDateRangeFilter('this-year');
    });
    expect(result.current.hasActiveFilter).toBe(true);
  });

  it('価格帯・日付範囲では記録種別を勝手に切り替えない', () => {
    const { result } = renderHook(() => useRecordList());

    act(() => {
      result.current.setPriceRangeFilter('over-10000');
      result.current.setDateRangeFilter('this-month');
    });

    expect(result.current.recordType).toBe('all');
  });
});


// 詳細フィルタの折りたたみ。常時出すのは記録種別・カテゴリ・並び替えと
// キーワード検索で、それ以外は畳んである。
//
// 畳んだまま条件が効いていると、記録が出ない理由が分からなくなるので、
// 効いている数をバッジに出し、0 でなければ開いた状態で始める。
describe('詳細フィルタの折りたたみ', () => {
  const ALWAYS_VISIBLE = ['filter-record-type', 'filter-category', 'sort-option', 'filter-search'];
  const ADVANCED = [
    'filter-drinking-status',
    'filter-rating',
    'filter-price-range',
    'filter-date-range',
  ];

  it('既定では詳細を畳み、常時出す条件だけを見せる', () => {
    renderControls();

    for (const testId of ALWAYS_VISIBLE) {
      expect(screen.getByTestId(testId), testId).toBeInTheDocument();
    }
    for (const testId of ADVANCED) {
      expect(screen.queryByTestId(testId), testId).not.toBeInTheDocument();
    }
    expect(screen.queryByTestId('filter-advanced-panel')).not.toBeInTheDocument();
  });

  it('ボタンを押すと開き、もう一度押すと畳む', () => {
    renderControls();
    const toggle = screen.getByTestId('filter-advanced-toggle');

    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    for (const testId of ADVANCED) {
      expect(screen.getByTestId(testId), testId).toBeInTheDocument();
    }

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('filter-advanced-panel')).not.toBeInTheDocument();
  });

  it('詳細に条件が入っていれば開いた状態で始める', () => {
    renderControls({ ratingFilter: 4 });

    expect(screen.getByTestId('filter-advanced-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('filter-rating')).toBeInTheDocument();
  });

  it('効いている詳細条件の数をバッジに出す', () => {
    renderControls({
      ratingFilter: 4,
      priceRangeFilter: '3000-5000',
      drinkingStatusFilter: 'NOT_STARTED',
    });

    expect(screen.getByTestId('filter-advanced-count')).toHaveTextContent('3');
  });

  it('詳細条件がどれも既定値ならバッジを出さない', () => {
    renderControls();
    expect(screen.queryByTestId('filter-advanced-count')).not.toBeInTheDocument();
  });

  it('条件を残したまま畳める（開いた状態で固定しない）', () => {
    renderControls({ ratingFilter: 4 });
    const toggle = screen.getByTestId('filter-advanced-toggle');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('filter-rating')).not.toBeInTheDocument();
    // 畳んでも、効いていること自体はバッジで分かる
    expect(screen.getByTestId('filter-advanced-count')).toHaveTextContent('1');
  });
});
