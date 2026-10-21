// 絞り込み条件の見出しと入力欄の結び付き。
//
// 見出しが <label> なのに htmlFor が無いと、読み上げは入力欄を名前なしで
// 読む。getByLabelText で取れることを、読み上げで名前が付くことの代わりに
// 確かめる。Select はモックせず、本物のトリガー（button）に id が載ることまで見る

import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

import { FilterControls } from '../components/FilterControls';
import type { DateRangeFilter, RatingFilter } from '../types';

const noop = vi.fn();

function renderControls(
  overrides: { ratingFilter?: RatingFilter; dateRangeFilter?: DateRangeFilter } = {},
) {
  return render(
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

describe('絞り込みの見出しと入力欄の結び付き', () => {
  it('常時出す条件は、見出しから入力欄を引ける', () => {
    renderControls();

    expect(screen.getByLabelText('記録種別')).toBe(screen.getByTestId('filter-record-type'));
    expect(screen.getByLabelText('カテゴリ')).toBe(screen.getByTestId('filter-category'));
    expect(screen.getByLabelText('並び替え')).toBe(screen.getByTestId('sort-option'));
    expect(screen.getByLabelText('キーワード検索')).toBe(screen.getByTestId('filter-search'));
  });

  it('詳細条件とカスタム範囲の日付も、見出しから入力欄を引ける', () => {
    // 評価を入れて詳細を開き、custom でカスタム範囲の日付入力まで出す
    renderControls({ ratingFilter: 4, dateRangeFilter: 'custom' });

    expect(screen.getByLabelText('飲みきり')).toBe(screen.getByTestId('filter-drinking-status'));
    expect(screen.getByLabelText('評価')).toBe(screen.getByTestId('filter-rating'));
    expect(screen.getByLabelText('価格帯')).toBe(screen.getByTestId('filter-price-range'));
    expect(screen.getByLabelText('日付')).toBe(screen.getByTestId('filter-date-range'));
    expect(screen.getByLabelText('開始日')).toBe(screen.getByTestId('filter-date-from'));
    expect(screen.getByLabelText('終了日')).toBe(screen.getByTestId('filter-date-to'));
  });

  it('2つ並べても id が衝突しない', () => {
    // 固定の id だと、同じ画面に2つ出たとき見出しが先の方の入力欄を指してしまう
    renderControls();
    renderControls();

    const triggers = screen.getAllByLabelText('記録種別');
    expect(triggers).toHaveLength(2);
    expect(triggers[0].id).not.toBe(triggers[1].id);
  });

  it('詳細の開閉ボタンは、開いたパネルを aria-controls で指す', () => {
    renderControls({ ratingFilter: 4 });

    const toggle = screen.getByTestId('filter-advanced-toggle');
    const panel = screen.getByTestId('filter-advanced-panel');
    expect(toggle).toHaveAttribute('aria-controls', panel.id);
  });
});
