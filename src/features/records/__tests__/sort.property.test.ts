import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { UnifiedRecord, SortOption } from '../types';
import { SAKE_CATEGORIES } from '../../purchase/types';
import { sortRecords } from '../hooks/useRecordSort';

// --- Arbitrary generators ---

const arbRecordType = fc.constantFrom('purchase' as const, 'drinking' as const);
const arbCategory = fc.constantFrom(...SAKE_CATEGORIES);
const arbDate = fc
  .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31'), noInvalidDate: true })
  .map((d) => d.toISOString().split('T')[0]);
const arbPrice = fc.option(fc.integer({ min: 0, max: 100000 }), { nil: null });

const arbUnifiedRecord: fc.Arbitrary<UnifiedRecord> = fc.record({
  id: fc.uuid(),
  type: arbRecordType,
  sakeName: fc.string({ minLength: 1, maxLength: 50 }),
  price: arbPrice,
  date: arbDate,
  category: arbCategory,
  memo: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
  storeName: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  placeName: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  drinkingMethod: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  rating: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
  createdAt: fc.constant(new Date().toISOString()),
  updatedAt: fc.constant(new Date().toISOString()),
});

const arbDateSortOption = fc.constantFrom<SortOption>('date-desc', 'date-asc');

// --- Property Tests ---

describe('Feature: sake-record-list, Property 4: 日付ソートの整列性', () => {
  it('日付ソートが隣接ペアの順序を正しく保証する', () => {
    fc.assert(
      fc.property(
        fc.array(arbUnifiedRecord),
        arbDateSortOption,
        (records, sortOption) => {
          const sorted = sortRecords(records, sortOption);

          for (let i = 0; i < sorted.length - 1; i++) {
            if (sortOption === 'date-desc') {
              expect(sorted[i].date >= sorted[i + 1].date).toBe(true);
            } else {
              expect(sorted[i].date <= sorted[i + 1].date).toBe(true);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

const arbPriceSortOption = fc.constantFrom<SortOption>('price-desc', 'price-asc');

describe('Feature: sake-record-list, Property 5: 価格ソートの整列性（null末尾保証）', () => {
  it('価格ソートでnull値が末尾に配置され、非null値が正しい順序で並ぶ', () => {
    fc.assert(
      fc.property(
        fc.array(arbUnifiedRecord),
        arbPriceSortOption,
        (records, sortOption) => {
          const sorted = sortRecords(records, sortOption);

          const firstNullIndex = sorted.findIndex((r) => r.price === null);
          if (firstNullIndex !== -1) {
            for (let i = firstNullIndex; i < sorted.length; i++) {
              expect(sorted[i].price).toBe(null);
            }
          }

          for (let i = 0; i < sorted.length - 1; i++) {
            if (sorted[i].price !== null && sorted[i + 1].price !== null) {
              if (sortOption === 'price-desc') {
                expect(sorted[i].price! >= sorted[i + 1].price!).toBe(true);
              } else {
                expect(sorted[i].price! <= sorted[i + 1].price!).toBe(true);
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


const arbRatingSortOption = fc.constantFrom<SortOption>('rating-desc', 'rating-asc');

describe('Feature: sake-record-list, Property 8: 評価ソートの整列性（undefined末尾保証）', () => {
  it('評価ソートでundefined値が末尾に配置され、非undefined値が正しい順序で並ぶ', () => {
    fc.assert(
      fc.property(
        fc.array(arbUnifiedRecord),
        arbRatingSortOption,
        (records, sortOption) => {
          const sorted = sortRecords(records, sortOption);

          // undefined末尾保証
          const firstUndefinedIndex = sorted.findIndex((r) => r.rating == null);
          if (firstUndefinedIndex !== -1) {
            for (let i = firstUndefinedIndex; i < sorted.length; i++) {
              expect(sorted[i].rating).toBeUndefined();
            }
          }

          // 非undefined隣接ペアの順序保証
          for (let i = 0; i < sorted.length - 1; i++) {
            if (sorted[i].rating != null && sorted[i + 1].rating != null) {
              if (sortOption === 'rating-desc') {
                expect(sorted[i].rating! >= sorted[i + 1].rating!).toBe(true);
              } else {
                expect(sorted[i].rating! <= sorted[i + 1].rating!).toBe(true);
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


const arbSortOption = fc.constantFrom<SortOption>(
  'date-desc', 'date-asc', 'price-desc', 'price-asc', 'rating-desc', 'rating-asc'
);

describe('Feature: sake-record-list, Property 7: ソートは要素を保存する（不変量）', () => {
  it('ソート結果が元のリストと同じ要素を同じ数だけ含む', () => {
    fc.assert(
      fc.property(
        fc.array(arbUnifiedRecord),
        arbSortOption,
        (records, sortOption) => {
          const sorted = sortRecords(records, sortOption);

          expect(sorted.length).toBe(records.length);

          for (const item of sorted) {
            expect(records).toContain(item);
          }

          for (const item of records) {
            expect(sorted).toContain(item);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
