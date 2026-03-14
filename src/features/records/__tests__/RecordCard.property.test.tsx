import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as fc from 'fast-check';
import type { UnifiedRecord } from '../types';
import { CATEGORY_FILTER_OPTIONS } from '../types';
import { SAKE_CATEGORIES } from '../../purchase/types';
import { RecordCard } from '../components/RecordCard';

// --- Arbitrary generators ---

const arbCategory = fc.constantFrom(...SAKE_CATEGORIES);
const arbDate = fc
  .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31'), noInvalidDate: true })
  .map((d) => d.toISOString().split('T')[0]);

/** 購入記録: storeName と price を必ず持つ */
const arbPurchaseRecord: fc.Arbitrary<UnifiedRecord> = fc.record({
  id: fc.uuid(),
  type: fc.constant('purchase' as const),
  sakeName: fc.string({ minLength: 1, maxLength: 50 }),
  price: fc.integer({ min: 0, max: 100000 }),
  date: arbDate,
  category: arbCategory,
  memo: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
  storeName: fc.string({ minLength: 1, maxLength: 50 }),
  placeName: fc.constant(undefined),
  drinkingMethod: fc.constant(undefined),
  rating: fc.constant(undefined),
  createdAt: fc.constant(new Date().toISOString()),
  updatedAt: fc.constant(new Date().toISOString()),
});

/** 飲酒記録: placeName, drinkingMethod, rating, price を必ず持つ */
const arbDrinkingRecord: fc.Arbitrary<UnifiedRecord> = fc.record({
  id: fc.uuid(),
  type: fc.constant('drinking' as const),
  sakeName: fc.string({ minLength: 1, maxLength: 50 }),
  price: fc.integer({ min: 0, max: 100000 }),
  date: arbDate,
  category: arbCategory,
  memo: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
  storeName: fc.constant(undefined),
  placeName: fc.string({ minLength: 1, maxLength: 50 }),
  drinkingMethod: fc.string({ minLength: 1, maxLength: 20 }),
  rating: fc.integer({ min: 1, max: 5 }),
  createdAt: fc.constant(new Date().toISOString()),
  updatedAt: fc.constant(new Date().toISOString()),
});

// --- Helper ---

function getCategoryLabel(category: string): string {
  const option = CATEGORY_FILTER_OPTIONS.find((o) => o.value === category);
  return option?.label ?? category;
}

// --- Property Tests ---

// Feature: sake-record-list, Property 8: RecordCard の必須フィールド表示
// **Validates: Requirements 1.2, 1.3, 1.4**
describe('Feature: sake-record-list, Property 8: RecordCard の必須フィールド表示', () => {
  it('購入記録: 銘柄名、カテゴリ、記録種別ラベル、購入店舗、価格、購入日を表示する', () => {
    fc.assert(
      fc.property(arbPurchaseRecord, (record) => {
        const { unmount } = render(<RecordCard record={record} />);

        // 共通フィールド
        expect(screen.getByTestId('sake-name').textContent).toBe(record.sakeName);
        expect(screen.getByTestId('category-label').textContent).toBe(
          getCategoryLabel(record.category),
        );
        expect(screen.getByTestId('record-type-label').textContent).toBe('購入');

        // 購入記録固有フィールド
        expect(screen.getByTestId('store-name').textContent).toContain(record.storeName);
        expect(screen.getByTestId('price').textContent).toContain(
          (record.price as number).toLocaleString(),
        );
        expect(screen.getByTestId('record-date').textContent).toBe(record.date);

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  it('飲酒記録: 銘柄名、カテゴリ、記録種別ラベル、飲んだ場所、飲んだ日、飲み方、評価を表示する', () => {
    fc.assert(
      fc.property(arbDrinkingRecord, (record) => {
        const { unmount } = render(<RecordCard record={record} />);

        // 共通フィールド
        expect(screen.getByTestId('sake-name').textContent).toBe(record.sakeName);
        expect(screen.getByTestId('category-label').textContent).toBe(
          getCategoryLabel(record.category),
        );
        expect(screen.getByTestId('record-type-label').textContent).toBe('飲酒');

        // 飲酒記録固有フィールド
        expect(screen.getByTestId('place-name').textContent).toContain(record.placeName);
        expect(screen.getByTestId('record-date').textContent).toBe(record.date);
        expect(screen.getByTestId('drinking-method').textContent).toContain(
          record.drinkingMethod,
        );
        expect(screen.getByTestId('rating')).toBeTruthy();
        expect(screen.getByTestId('price').textContent).toContain(
          (record.price as number).toLocaleString(),
        );

        unmount();
      }),
      { numRuns: 100 },
    );
  });
});
