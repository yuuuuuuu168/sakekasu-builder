// 詳細フィルタとして畳む条件と、効いている数の数え方。
//
// 折りたたみの中身とバッジの数はこの1か所で決めている。
// 片方だけ足すと、隠れているのにバッジに出ない条件ができてしまうので、
// 「常時出す条件は数えない」ところまで固定しておく。

import { describe, it, expect } from 'vitest';
import {
  ADVANCED_FILTER_KEYS,
  countActiveAdvancedFilters,
} from '../lib/advancedFilters';
import { DEFAULT_FILTERS } from '../types';

describe('詳細フィルタの数え方', () => {
  it('どれも既定値なら0', () => {
    expect(countActiveAdvancedFilters(DEFAULT_FILTERS)).toBe(0);
  });

  it.each([
    [{ drinkingStatus: 'NOT_STARTED' as const }, 1],
    [{ rating: 4 as const }, 1],
    [{ priceRange: '3000-5000' as const }, 1],
    [{ dateRange: 'this-month' as const }, 1],
    [{ rating: 4 as const, priceRange: 'over-10000' as const }, 2],
    [
      {
        drinkingStatus: 'FINISHED' as const,
        rating: 3 as const,
        priceRange: 'under-1000' as const,
        dateRange: 'custom' as const,
      },
      4,
    ],
  ])('%o は %i 件', (overrides, expected) => {
    expect(countActiveAdvancedFilters({ ...DEFAULT_FILTERS, ...overrides })).toBe(expected);
  });

  it('常時出す条件は数に入れない', () => {
    const filters = {
      ...DEFAULT_FILTERS,
      recordType: 'drinking' as const,
      category: 'WHISKY' as const,
      searchQuery: '山崎',
    };
    expect(countActiveAdvancedFilters(filters)).toBe(0);
  });

  it('数える対象は4つ（増減したらここも直す）', () => {
    expect([...ADVANCED_FILTER_KEYS]).toEqual([
      'drinkingStatus',
      'rating',
      'priceRange',
      'dateRange',
    ]);
  });
});
