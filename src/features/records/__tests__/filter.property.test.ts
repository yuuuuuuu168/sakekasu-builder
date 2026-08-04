import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type {
  UnifiedRecord,
  RecordTypeFilter,
  CategoryFilter,
  RatingFilter,
  RecordFilters,
} from '../types';
import { DEFAULT_FILTERS } from '../types';
import { SAKE_CATEGORIES } from '../../purchase/types';
import { filterRecords, fuzzyMatch, matchesSearchQuery } from '../hooks/useRecordFilter';

// --- Helpers ---

/** 既定値をベースに、指定した条件だけ上書きしたフィルタを作る */
function filters(overrides: Partial<RecordFilters> = {}): RecordFilters {
  return { ...DEFAULT_FILTERS, ...overrides };
}

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
  imageKeys: fc.constant([]),
  createdAt: fc.constant(new Date().toISOString()),
  updatedAt: fc.constant(new Date().toISOString()),
});

const arbRecordTypeFilter = fc.constantFrom<RecordTypeFilter>('all', 'purchase', 'drinking');
const arbCategoryFilter = fc.constantFrom<CategoryFilter>('all', ...SAKE_CATEGORIES);
const arbSearchQuery = fc.oneof(fc.constant(''), fc.string({ minLength: 1, maxLength: 10 }));
const arbRatingFilter = fc.constantFrom<RatingFilter>('all', 1, 2, 3, 4, 5);

// --- Property Tests ---

describe('Feature: sake-record-list, Property 1: 記録種別フィルタの正確性', () => {
  it('記録種別フィルタが正確にレコードを絞り込む', () => {
    fc.assert(
      fc.property(
        fc.array(arbUnifiedRecord),
        arbRecordTypeFilter,
        (records, typeFilter) => {
          const result = filterRecords(records, filters({ recordType: typeFilter }));

          if (typeFilter === 'all') {
            expect(result.length).toBe(records.length);
          } else if (typeFilter === 'purchase') {
            expect(result.every((r) => r.type === 'purchase')).toBe(true);
          } else if (typeFilter === 'drinking') {
            expect(result.every((r) => r.type === 'drinking')).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Feature: sake-record-list, Property 2: カテゴリフィルタの正確性', () => {
  it('カテゴリフィルタが正確にレコードを絞り込む', () => {
    fc.assert(
      fc.property(
        fc.array(arbUnifiedRecord),
        arbCategoryFilter,
        (records, categoryFilter) => {
          const result = filterRecords(records, filters({ category: categoryFilter }));

          if (categoryFilter === 'all') {
            expect(result.length).toBe(records.length);
          } else {
            expect(result.every((r) => r.category === categoryFilter)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Feature: sake-record-list, Property 3: フィルタの合成（AND条件）', () => {
  it('両フィルタを同時に適用した結果と、順番に適用した結果が等しい', () => {
    fc.assert(
      fc.property(
        fc.array(arbUnifiedRecord),
        arbRecordTypeFilter,
        arbCategoryFilter,
        (records, typeFilter, categoryFilter) => {
          const combined = filterRecords(
            records,
            filters({ recordType: typeFilter, category: categoryFilter })
          );
          const sequential1 = filterRecords(
            filterRecords(records, filters({ recordType: typeFilter })),
            filters({ category: categoryFilter })
          );
          const sequential2 = filterRecords(
            filterRecords(records, filters({ category: categoryFilter })),
            filters({ recordType: typeFilter })
          );

          expect(combined).toEqual(sequential1);
          expect(combined).toEqual(sequential2);
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Feature: sake-record-list, Property 6: フィルタはレコードを追加しない（メタモルフィック）', () => {
  it('フィルタ結果の長さは元のリスト以下であり、結果の全要素は元のリストに含まれる', () => {
    fc.assert(
      fc.property(
        fc.array(arbUnifiedRecord),
        arbRecordTypeFilter,
        arbCategoryFilter,
        arbSearchQuery,
        arbRatingFilter,
        (records, typeFilter, categoryFilter, searchQuery, ratingFilter) => {
          const result = filterRecords(
            records,
            filters({
              recordType: typeFilter,
              category: categoryFilter,
              searchQuery,
              rating: ratingFilter,
            })
          );

          expect(result.length).toBeLessThanOrEqual(records.length);

          for (const item of result) {
            expect(records).toContainEqual(item);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Feature: sake-record-list, Property 8: キーワード検索の正確性', () => {
  it('検索クエリが空の場合、全レコードが返る', () => {
    fc.assert(
      fc.property(
        fc.array(arbUnifiedRecord),
        (records) => {
          const result = filterRecords(records, filters({ searchQuery: '' }));
          expect(result.length).toBe(records.length);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('fuzzyMatchがクエリの各文字の順序出現を正しく判定する', () => {
    // 部分文字列は必ずマッチする
    fc.assert(
      fc.property(
        fc.string({ minLength: 2, maxLength: 20 }),
        (target) => {
          if (target.length >= 2) {
            // 先頭と末尾の文字を取ったクエリは必ずマッチ
            const query = target[0] + target[target.length - 1];
            expect(fuzzyMatch(target, query)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('ターゲットに含まれない文字のクエリはマッチしない', () => {
    // ASCII文字のみのターゲットに対して、ターゲットに含まれない文字はマッチしない
    expect(fuzzyMatch('abc', 'z')).toBe(false);
    expect(fuzzyMatch('hello', 'xyz')).toBe(false);
  });

  it('検索結果の全レコードがいずれかの項目でクエリにマッチする', () => {
    fc.assert(
      fc.property(
        fc.array(arbUnifiedRecord),
        fc.string({ minLength: 1, maxLength: 5 }),
        (records, query) => {
          const result = filterRecords(records, filters({ searchQuery: query }));
          const normalizedQuery = query.toLowerCase().trim();
          if (normalizedQuery !== '') {
            for (const r of result) {
              expect(matchesSearchQuery(r, normalizedQuery)).toBe(true);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Feature: sake-record-list, Property 9: 評価フィルタの正確性', () => {
  it('★N以上フィルタの結果は評価N以上の飲酒記録だけになる', () => {
    fc.assert(
      fc.property(
        fc.array(arbUnifiedRecord),
        fc.integer({ min: 1, max: 5 }),
        (records, threshold) => {
          const result = filterRecords(
            records,
            filters({ rating: threshold as RatingFilter })
          );

          for (const r of result) {
            expect(r.type).toBe('drinking');
            expect(r.rating ?? 0).toBeGreaterThanOrEqual(threshold);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('しきい値を上げると結果は減りこそすれ増えない（単調性）', () => {
    fc.assert(
      fc.property(
        fc.array(arbUnifiedRecord),
        fc.integer({ min: 1, max: 4 }),
        (records, threshold) => {
          const looser = filterRecords(records, filters({ rating: threshold as RatingFilter }));
          const stricter = filterRecords(
            records,
            filters({ rating: (threshold + 1) as RatingFilter })
          );

          expect(stricter.length).toBeLessThanOrEqual(looser.length);
          for (const item of stricter) {
            expect(looser).toContainEqual(item);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('評価フィルタ all は評価を理由に絞り込まない', () => {
    fc.assert(
      fc.property(
        fc.array(arbUnifiedRecord),
        (records) => {
          const result = filterRecords(records, filters({ rating: 'all' }));
          expect(result.length).toBe(records.length);
        }
      ),
      { numRuns: 50 }
    );
  });
});
