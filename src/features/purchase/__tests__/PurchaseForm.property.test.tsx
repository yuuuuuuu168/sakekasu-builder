// Feature: sake-purchase-registration, Property 5: 保存成功後のフォームリセット

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as fc from 'fast-check';
import { SAKE_CATEGORIES } from '@/features/purchase/types';
import type { PurchaseFormData } from '@/features/purchase/types';
import { getInitialFormData } from '@/features/purchase/hooks/usePurchaseForm';

// usePurchaseStorage をモック: 常に成功を返す
const mockSavePurchase = vi.fn(async () => ({ success: true }));

vi.mock('@/features/purchase/hooks/usePurchaseStorage', () => ({
  usePurchaseStorage: () => ({
    savePurchase: mockSavePurchase,
    isSaving: false,
  }),
}));

import { usePurchaseForm } from '@/features/purchase/hooks/usePurchaseForm';

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
 * Property 5: 保存成功後のフォームリセット
 * Validates: Requirements 3.3, 5.1
 *
 * ランダムな有効入力データ + 保存成功モックでフォームリセットを検証する。
 * usePurchaseForm フックを renderHook でテストし、
 * handleChange で各フィールドを設定後、handleSubmit を呼び出し、
 * フォームデータが初期状態にリセットされることを確認する。
 */
describe('Property 5: 保存成功後のフォームリセット', () => {
  beforeEach(() => {
    mockSavePurchase.mockClear();
  });

  it('有効な入力データで保存成功後、フォームが初期状態にリセットされる', async () => {
    await fc.assert(
      fc.asyncProperty(validFormDataArb, async (formData) => {
        mockSavePurchase.mockClear();

        const { result } = renderHook(() => usePurchaseForm());

        // handleChange で各フィールドを設定
        act(() => {
          result.current.handleChange('sakeName', formData.sakeName);
          result.current.handleChange('storeName', formData.storeName);
          result.current.handleChange('price', formData.price);
          result.current.handleChange('purchaseDate', formData.purchaseDate);
          result.current.handleChange('category', formData.category);
          result.current.handleChange('memo', formData.memo);
        });

        // 入力値が反映されていることを確認
        expect(result.current.formData.sakeName).toBe(formData.sakeName);
        expect(result.current.formData.storeName).toBe(formData.storeName);
        expect(result.current.formData.price).toBe(formData.price);
        expect(result.current.formData.purchaseDate).toBe(formData.purchaseDate);
        expect(result.current.formData.category).toBe(formData.category);
        expect(result.current.formData.memo).toBe(formData.memo);

        // handleSubmit を呼び出し
        await act(async () => {
          await result.current.handleSubmit();
        });

        // savePurchase が呼ばれたことを確認
        expect(mockSavePurchase).toHaveBeenCalledTimes(1);

        // フォームが初期状態にリセットされていることを検証
        const initial = getInitialFormData();
        expect(result.current.formData.sakeName).toBe(initial.sakeName);
        expect(result.current.formData.storeName).toBe(initial.storeName);
        expect(result.current.formData.price).toBe(initial.price);
        expect(result.current.formData.purchaseDate).toBe(initial.purchaseDate);
        expect(result.current.formData.category).toBe(initial.category);
        expect(result.current.formData.memo).toBe(initial.memo);
      }),
      { numRuns: 100 },
    );
  });
});


// Feature: sake-purchase-registration, Property 6: 保存失敗時の入力保持

/**
 * Property 6: 保存失敗時の入力保持
 * Validates: Requirements 3.5
 *
 * ランダムな有効入力データ + 保存失敗モックで入力値保持を検証する。
 * usePurchaseForm フックを renderHook でテストし、
 * handleChange で各フィールドを設定後、handleSubmit を呼び出し（保存失敗）、
 * フォームデータが送信前の入力値をそのまま保持していることを確認する。
 */
describe('Property 6: 保存失敗時の入力保持', () => {
  beforeEach(() => {
    mockSavePurchase.mockClear();
    mockSavePurchase.mockResolvedValue({
      success: false,
      error: '登録に失敗しました。もう一度お試しください',
    });
  });

  afterEach(() => {
    // 他のテストに影響しないよう、成功を返すデフォルトに戻す
    mockSavePurchase.mockResolvedValue({ success: true });
  });

  it('有効な入力データで保存失敗後、フォームの入力値が保持される', async () => {
    await fc.assert(
      fc.asyncProperty(validFormDataArb, async (formData) => {
        mockSavePurchase.mockClear();
        mockSavePurchase.mockResolvedValue({
          success: false,
          error: '登録に失敗しました。もう一度お試しください',
        });

        const { result } = renderHook(() => usePurchaseForm());

        // handleChange で各フィールドを設定
        act(() => {
          result.current.handleChange('sakeName', formData.sakeName);
          result.current.handleChange('storeName', formData.storeName);
          result.current.handleChange('price', formData.price);
          result.current.handleChange('purchaseDate', formData.purchaseDate);
          result.current.handleChange('category', formData.category);
          result.current.handleChange('memo', formData.memo);
        });

        // 入力値が反映されていることを確認
        expect(result.current.formData.sakeName).toBe(formData.sakeName);
        expect(result.current.formData.storeName).toBe(formData.storeName);
        expect(result.current.formData.price).toBe(formData.price);
        expect(result.current.formData.purchaseDate).toBe(formData.purchaseDate);
        expect(result.current.formData.category).toBe(formData.category);
        expect(result.current.formData.memo).toBe(formData.memo);

        // handleSubmit を呼び出し（保存は失敗する）
        await act(async () => {
          await result.current.handleSubmit();
        });

        // savePurchase が呼ばれたことを確認
        expect(mockSavePurchase).toHaveBeenCalledTimes(1);

        // 保存失敗後、フォームの入力値が保持されていることを検証
        expect(result.current.formData.sakeName).toBe(formData.sakeName);
        expect(result.current.formData.storeName).toBe(formData.storeName);
        expect(result.current.formData.price).toBe(formData.price);
        expect(result.current.formData.purchaseDate).toBe(formData.purchaseDate);
        expect(result.current.formData.category).toBe(formData.category);
        expect(result.current.formData.memo).toBe(formData.memo);

        // submitResult にエラー情報が設定されていることを確認
        expect(result.current.submitResult).toEqual({
          success: false,
          error: '登録に失敗しました。もう一度お試しください',
        });
      }),
      { numRuns: 100 },
    );
  });
});


// Feature: sake-purchase-registration, Property 9: 連続登録時の成功メッセージ表示

/**
 * Property 9: 連続登録時の成功メッセージ表示
 * Validates: Requirements 5.2
 *
 * ランダムな回数（2〜10）の有効入力データで各登録後に成功メッセージが表示されることを検証する。
 * 単一の renderHook インスタンスで連続登録を行い、
 * 各登録ごとに submitResult が { success: true } であること、
 * フォームが初期状態にリセットされること、
 * 最終的に mockSavePurchase が N 回呼ばれることを確認する。
 */
describe('Property 9: 連続登録時の成功メッセージ表示', () => {
  beforeEach(() => {
    mockSavePurchase.mockClear();
    mockSavePurchase.mockResolvedValue({ success: true });
  });

  it('連続した有効な登録操作の各回で成功メッセージが表示される', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(validFormDataArb, { minLength: 2, maxLength: 10 }),
        async (formDataArray) => {
          mockSavePurchase.mockClear();
          mockSavePurchase.mockResolvedValue({ success: true });

          const { result } = renderHook(() => usePurchaseForm());
          const initial = getInitialFormData();

          for (let i = 0; i < formDataArray.length; i++) {
            const formData = formDataArray[i];

            // handleChange で各フィールドを設定
            act(() => {
              result.current.handleChange('sakeName', formData.sakeName);
              result.current.handleChange('storeName', formData.storeName);
              result.current.handleChange('price', formData.price);
              result.current.handleChange('purchaseDate', formData.purchaseDate);
              result.current.handleChange('category', formData.category);
              result.current.handleChange('memo', formData.memo);
            });

            // handleSubmit を呼び出し
            await act(async () => {
              await result.current.handleSubmit();
            });

            // 各登録後に submitResult が成功であることを検証
            expect(result.current.submitResult).toEqual({ success: true });

            // フォームが初期状態にリセットされていることを検証
            expect(result.current.formData.sakeName).toBe(initial.sakeName);
            expect(result.current.formData.storeName).toBe(initial.storeName);
            expect(result.current.formData.price).toBe(initial.price);
            expect(result.current.formData.purchaseDate).toBe(initial.purchaseDate);
            expect(result.current.formData.category).toBe(initial.category);
            expect(result.current.formData.memo).toBe(initial.memo);
          }

          // 全登録完了後、mockSavePurchase が N 回呼ばれたことを確認
          expect(mockSavePurchase).toHaveBeenCalledTimes(formDataArray.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
