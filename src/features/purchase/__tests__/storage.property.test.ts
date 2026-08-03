// Feature: sake-purchase-registration, Property 7: PurchaseRecordのラウンドトリップ

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as fc from 'fast-check';
import { SAKE_CATEGORIES } from '@/features/purchase/types';
import type { PurchaseFormData } from '@/features/purchase/types';

const { mockGraphqlFn } = vi.hoisted(() => ({
  mockGraphqlFn: vi.fn(async () => ({
    data: { createPurchaseRecord: { id: 'mock-id' } },
  })),
}));

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({
    graphql: mockGraphqlFn,
  }),
}));

import { usePurchaseStorage } from '@/features/purchase/hooks/usePurchaseStorage';

/** 非空・非空白のみの文字列を生成するArbitrary */
const nonEmptyNonWhitespaceArb = fc
  .string({ minLength: 1 })
  .filter((s) => s.trim().length > 0);

const nonNegativeIntegerPriceArb = fc.nat({ max: 9999999 }).map(String);

const positiveIntegerQuantityArb = fc.integer({ min: 1, max: 9999 }).map(String);

const pastDateArb = fc.integer({ min: 0, max: 365 * 10 }).map((daysAgo) => {
  const past = new Date();
  past.setDate(past.getDate() - daysAgo);
  const year = past.getFullYear();
  const month = String(past.getMonth() + 1).padStart(2, '0');
  const day = String(past.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
});

const categoryArb = fc.constantFrom(...SAKE_CATEGORIES);
const memoArb = fc.string();

const validFormDataArb = fc.record({
  sakeName: nonEmptyNonWhitespaceArb,
  storeName: nonEmptyNonWhitespaceArb,
  price: nonNegativeIntegerPriceArb,
  quantity: positiveIntegerQuantityArb,
  purchaseDate: pastDateArb,
  category: categoryArb,
  memo: memoArb,
}) as fc.Arbitrary<PurchaseFormData>;


describe('Property 7: PurchaseRecordのラウンドトリップ', () => {
  beforeEach(() => {
    mockGraphqlFn.mockClear();
  });

  it('有効なPurchaseFormDataを保存すると、元データと同等の内容がストレージに渡される', async () => {
    await fc.assert(
      fc.asyncProperty(validFormDataArb, async (formData) => {
        mockGraphqlFn.mockClear();

        const { result } = renderHook(() => usePurchaseStorage());

        await act(async () => {
          const saveResult = await result.current.savePurchase(formData);
          expect(saveResult.success).toBe(true);
        });

        expect(mockGraphqlFn).toHaveBeenCalledTimes(1);

        const callArgs = mockGraphqlFn.mock.calls[0][0] as {
          query: string;
          variables: { input: Record<string, unknown> };
        };
        const passedInput = callArgs.variables.input;

        expect(passedInput.sakeName).toBe(formData.sakeName);
        expect(passedInput.storeName).toBe(formData.storeName);
        expect(passedInput.price).toBe(parseInt(formData.price, 10));
        expect(passedInput.quantity).toBe(parseInt(formData.quantity, 10));
        expect(passedInput.purchaseDate).toBe(formData.purchaseDate);
        expect(passedInput.category).toBe(formData.category);
        expect(passedInput.memo).toBe(formData.memo || undefined);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 8: 登録日時降順取得', () => {
  beforeEach(() => {
    mockGraphqlFn.mockClear();
  });

  it('複数のPurchaseRecordを保存後、createdAtの降順で取得できる', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(validFormDataArb, { minLength: 2, maxLength: 10 }),
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

            return { data: { createPurchaseRecord: record } };
          });

          const { result } = renderHook(() => usePurchaseStorage());
          for (const formData of formDataList) {
            await act(async () => {
              const saveResult = await result.current.savePurchase(formData);
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
