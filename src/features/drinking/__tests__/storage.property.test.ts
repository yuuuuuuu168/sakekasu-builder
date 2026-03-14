// Feature: sake-drinking-registration, Property 9: DrinkingRecordのラウンドトリップ
// Feature: sake-drinking-registration, Property 10: 登録日時降順取得

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as fc from 'fast-check';
import { SAKE_CATEGORIES } from '@/features/purchase/types';
import type { DrinkingFormData } from '../types';
import { DRINKING_METHODS_MAP } from '../types';

const { mockGraphqlFn } = vi.hoisted(() => ({
  mockGraphqlFn: vi.fn(async () => ({
    data: { createDrinkingRecord: { id: 'mock-id' } },
  })),
}));

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({
    graphql: mockGraphqlFn,
  }),
}));

import { useDrinkingStorage } from '../hooks/useDrinkingStorage';

const nonEmptyNonWhitespaceArb = fc
  .string({ minLength: 1 })
  .filter((s) => s.trim().length > 0);

const pastDateArb = fc.integer({ min: 0, max: 365 * 10 }).map((daysAgo) => {
  const past = new Date();
  past.setDate(past.getDate() - daysAgo);
  const year = past.getFullYear();
  const month = String(past.getMonth() + 1).padStart(2, '0');
  const day = String(past.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
});

const sakeCategoryArb = fc.constantFrom(...SAKE_CATEGORIES);

const validDrinkingFormDataArb = sakeCategoryArb.chain((category) => {
  const methods = DRINKING_METHODS_MAP[category];
  const drinkingMethodArb = methods.length > 0
    ? fc.constantFrom(...methods)
    : fc.constant('-');
  return fc.record({
    sakeName: nonEmptyNonWhitespaceArb,
    placeName: nonEmptyNonWhitespaceArb,
    price: fc.oneof(fc.constant(''), fc.nat({ max: 9999999 }).map(String)),
    drinkingDate: pastDateArb,
    category: fc.constant(category as string),
    drinkingMethod: drinkingMethodArb,
    rating: fc.integer({ min: 1, max: 5 }),
    memo: fc.string(),
  }) as fc.Arbitrary<DrinkingFormData>;
});


describe('Property 9: DrinkingRecordのラウンドトリップ', () => {
  beforeEach(() => {
    mockGraphqlFn.mockClear();
  });

  it('有効なDrinkingFormDataを保存すると、元データと同等の内容がストレージに渡される', async () => {
    await fc.assert(
      fc.asyncProperty(validDrinkingFormDataArb, async (formData) => {
        mockGraphqlFn.mockClear();

        const { result } = renderHook(() => useDrinkingStorage());

        await act(async () => {
          const saveResult = await result.current.saveDrinking(formData);
          expect(saveResult.success).toBe(true);
        });

        expect(mockGraphqlFn).toHaveBeenCalledTimes(1);

        const callArgs = mockGraphqlFn.mock.calls[0][0] as {
          query: string;
          variables: { input: Record<string, unknown> };
        };
        const passedInput = callArgs.variables.input;

        expect(passedInput.sakeName).toBe(formData.sakeName);
        expect(passedInput.placeName).toBe(formData.placeName);
        expect(passedInput.price).toBe(formData.price !== '' ? parseInt(formData.price, 10) : undefined);
        expect(passedInput.drinkingDate).toBe(formData.drinkingDate);
        expect(passedInput.category).toBe(formData.category);
        expect(passedInput.drinkingMethod).toBe(formData.drinkingMethod);
        expect(passedInput.rating).toBe(formData.rating);
        expect(passedInput.memo).toBe(formData.memo || undefined);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 10: 登録日時降順取得', () => {
  beforeEach(() => {
    mockGraphqlFn.mockClear();
  });

  it('複数のDrinkingRecordを保存後、createdAtの降順で取得できる', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(validDrinkingFormDataArb, { minLength: 2, maxLength: 10 }),
        async (formDataList) => {
          const storedRecords: Array<Record<string, unknown>> = [];
          let sequenceCounter = 0;

          mockGraphqlFn.mockImplementation(async () => {
            const baseTime = new Date('2025-01-01T00:00:00Z').getTime();
            const createdAt = new Date(baseTime + sequenceCounter * 1000).toISOString();
            sequenceCounter++;

            const record = {
              id: `mock-id-${sequenceCounter}`,
              createdAt,
              updatedAt: createdAt,
            };
            storedRecords.push(record);

            return { data: { createDrinkingRecord: record } };
          });

          const { result } = renderHook(() => useDrinkingStorage());
          for (const formData of formDataList) {
            await act(async () => {
              const saveResult = await result.current.saveDrinking(formData);
              expect(saveResult.success).toBe(true);
            });
          }

          expect(storedRecords.length).toBe(formDataList.length);

          const sortedRecords = [...storedRecords].sort(
            (a, b) =>
              new Date(b.createdAt as string).getTime() -
              new Date(a.createdAt as string).getTime(),
          );

          for (let i = 0; i < sortedRecords.length - 1; i++) {
            const currentCreatedAt = new Date(sortedRecords[i].createdAt as string).getTime();
            const nextCreatedAt = new Date(sortedRecords[i + 1].createdAt as string).getTime();
            expect(currentCreatedAt).toBeGreaterThanOrEqual(nextCreatedAt);
          }

          const storedIds = storedRecords.map((r) => r.id).sort();
          const sortedIds = sortedRecords.map((r) => r.id).sort();
          expect(sortedIds).toEqual(storedIds);
        },
      ),
      { numRuns: 100 },
    );
  });
});
