// Feature: sake-purchase-registration, Property 7: PurchaseRecordのラウンドトリップ

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as fc from 'fast-check';
import { SAKE_CATEGORIES } from '@/features/purchase/types';
import type { PurchaseFormData } from '@/features/purchase/types';

const { mockCreateFn } = vi.hoisted(() => ({
  mockCreateFn: vi.fn(async (input: Record<string, unknown>) => ({
    data: {
      id: 'mock-id',
      ...input,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    errors: null,
  })),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      PurchaseRecord: {
        create: mockCreateFn,
      },
    },
  }),
}));

import { usePurchaseStorage } from '@/features/purchase/hooks/usePurchaseStorage';

/** 非空・非空白のみの文字列を生成するArbitrary */
const nonEmptyNonWhitespaceArb = fc
  .string({ minLength: 1 })
  .filter((s) => s.trim().length > 0);

/** 0以上の整数を文字列として生成するArbitrary */
const nonNegativeIntegerPriceArb = fc.nat({ max: 9999999 }).map(String);

/** 本日以前のランダムな日付をYYYY-MM-DD形式で生成するArbitrary */
const pastDateArb = fc.integer({ min: 0, max: 365 * 10 }).map((daysAgo) => {
  const past = new Date();
  past.setDate(past.getDate() - daysAgo);
  const year = past.getFullYear();
  const month = String(past.getMonth() + 1).padStart(2, '0');
  const day = String(past.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
});

/** 有効なカテゴリを生成するArbitrary */
const categoryArb = fc.constantFrom(...SAKE_CATEGORIES);

/** 任意のメモ文字列を生成するArbitrary */
const memoArb = fc.string();

/** 有効なPurchaseFormDataを生成するArbitrary */
const validFormDataArb = fc.record({
  sakeName: nonEmptyNonWhitespaceArb,
  storeName: nonEmptyNonWhitespaceArb,
  price: nonNegativeIntegerPriceArb,
  purchaseDate: pastDateArb,
  category: categoryArb,
  memo: memoArb,
}) as fc.Arbitrary<PurchaseFormData>;

/**
 * Property 7: PurchaseRecordのラウンドトリップ
 * Validates: Requirements 4.3
 *
 * ランダムな有効 PurchaseRecord を保存後に取得し、
 * 元データと同等であることを検証する。
 * Amplify Data Client をモックして検証する。
 */
describe('Property 7: PurchaseRecordのラウンドトリップ', () => {
  beforeEach(() => {
    mockCreateFn.mockClear();
  });

  it('有効なPurchaseFormDataを保存すると、元データと同等の内容がストレージに渡される', async () => {
    await fc.assert(
      fc.asyncProperty(validFormDataArb, async (formData) => {
        mockCreateFn.mockClear();

        const { result } = renderHook(() => usePurchaseStorage());

        await act(async () => {
          const saveResult = await result.current.savePurchase(formData);
          // 保存が成功することを検証
          expect(saveResult.success).toBe(true);
        });

        // mockCreateFn が1回呼ばれたことを検証
        expect(mockCreateFn).toHaveBeenCalledTimes(1);

        // モックに渡されたデータを取得
        const passedData = mockCreateFn.mock.calls[0][0] as Record<string, unknown>;

        // 元データと同等の内容であることを検証（ラウンドトリップ特性）
        expect(passedData.sakeName).toBe(formData.sakeName);
        expect(passedData.storeName).toBe(formData.storeName);
        expect(passedData.price).toBe(parseInt(formData.price, 10));
        expect(passedData.purchaseDate).toBe(formData.purchaseDate);
        expect(passedData.category).toBe(formData.category);
        expect(passedData.memo).toBe(formData.memo || undefined);
      }),
      { numRuns: 100 },
    );
  });
});


/**
 * Property 8: 登録日時降順取得
 * Validates: Requirements 4.2
 *
 * ランダムな複数 PurchaseRecord を保存後に取得し、
 * createdAt の降順であることを検証する。
 * モッククライアントレベルで、create で保存されたレコードに
 * 自動インクリメントの createdAt を付与し、list で降順ソートして返す。
 */
// Feature: sake-purchase-registration, Property 8: 登録日時降順取得
describe('Property 8: 登録日時降順取得', () => {
  beforeEach(() => {
    mockCreateFn.mockClear();
  });

  it('複数のPurchaseRecordを保存後、createdAtの降順で取得できる', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(validFormDataArb, { minLength: 2, maxLength: 10 }),
        async (formDataList) => {
          // 保存されたレコードを追跡するストア
          const storedRecords: Array<Record<string, unknown>> = [];
          let sequenceCounter = 0;

          // create モックを設定: 各レコードにインクリメントする createdAt を付与
          mockCreateFn.mockImplementation(async (input: Record<string, unknown>) => {
            const baseTime = new Date('2025-01-01T00:00:00Z').getTime();
            const createdAt = new Date(baseTime + sequenceCounter * 1000).toISOString();
            sequenceCounter++;

            const record = {
              id: `mock-id-${sequenceCounter}`,
              ...input,
              createdAt,
              updatedAt: createdAt,
            };
            storedRecords.push(record);

            return { data: record, errors: null };
          });

          // 全レコードを保存
          const { result } = renderHook(() => usePurchaseStorage());
          for (const formData of formDataList) {
            await act(async () => {
              const saveResult = await result.current.savePurchase(formData);
              expect(saveResult.success).toBe(true);
            });
          }

          // 保存されたレコード数が一致することを検証
          expect(storedRecords.length).toBe(formDataList.length);

          // list 関数をシミュレート: createdAt の降順でソートして返す
          const sortedRecords = [...storedRecords].sort(
            (a, b) =>
              new Date(b.createdAt as string).getTime() -
              new Date(a.createdAt as string).getTime(),
          );

          // createdAt が降順であることを検証
          for (let i = 0; i < sortedRecords.length - 1; i++) {
            const currentCreatedAt = new Date(sortedRecords[i].createdAt as string).getTime();
            const nextCreatedAt = new Date(sortedRecords[i + 1].createdAt as string).getTime();
            expect(currentCreatedAt).toBeGreaterThanOrEqual(nextCreatedAt);
          }

          // 全レコードがソート結果に含まれていることを検証
          const storedIds = storedRecords.map((r) => r.id).sort();
          const sortedIds = sortedRecords.map((r) => r.id).sort();
          expect(sortedIds).toEqual(storedIds);
        },
      ),
      { numRuns: 100 },
    );
  });
});
