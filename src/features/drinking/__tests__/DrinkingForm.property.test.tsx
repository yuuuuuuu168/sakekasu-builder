// Feature: sake-drinking-registration, Property 7: 保存成功後のフォームリセット（飲んだ場所保持）

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as fc from 'fast-check';
import { SAKE_CATEGORIES } from '@/features/purchase/types';
import type { DrinkingFormData } from '@/features/drinking/types';
import {
  DRINKING_METHODS_MAP,
} from '@/features/drinking/types';

// useDrinkingStorage をモック: 常に成功を返す
const mockSaveDrinking = vi.fn(async () => ({ success: true }));

vi.mock('@/features/drinking/hooks/useDrinkingStorage', () => ({
  useDrinkingStorage: () => ({
    saveDrinking: mockSaveDrinking,
    isSaving: false,
  }),
}));

import { useDrinkingForm, getInitialDrinkingFormData } from '@/features/drinking/hooks/useDrinkingForm';

/** 本日以前のランダムな日付をYYYY-MM-DD形式で生成するArbitrary */
const pastDateArb = fc.integer({ min: 0, max: 365 * 10 }).map((daysAgo) => {
  const past = new Date();
  past.setDate(past.getDate() - daysAgo);
  const year = past.getFullYear();
  const month = String(past.getMonth() + 1).padStart(2, '0');
  const day = String(past.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
});

/** カテゴリArbitrary */
const sakeCategoryArb = fc.constantFrom(...SAKE_CATEGORIES);

/** 有効なDrinkingFormDataを生成するArbitrary */
const validDrinkingFormDataArb = sakeCategoryArb.chain((category) => {
  const methods = DRINKING_METHODS_MAP[category];
  const drinkingMethodArb = methods.length > 0
    ? fc.constantFrom(...methods)
    : fc.constant('-');
  return fc.record({
    sakeName: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
    placeName: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
    price: fc.oneof(fc.constant(''), fc.nat({ max: 9999999 }).map(String)),
    drinkingDate: pastDateArb,
    category: fc.constant(category as string),
    drinkingMethod: drinkingMethodArb,
    rating: fc.integer({ min: 1, max: 5 }),
    memo: fc.string(),
  }) as fc.Arbitrary<DrinkingFormData>;
});


/**
 * Property 7: 保存成功後のフォームリセット（飲んだ場所保持）
 * Validates: Requirements 3.3, 5.1, 5.3
 *
 * ランダムな有効入力データ + 保存成功モックでフォームリセットを検証する。
 * useDrinkingForm フックを renderHook でテストし、
 * handleChange で各フィールドを設定後、handleSubmit を呼び出し、
 * 飲んだ場所のみ前回値が保持され、他のフィールドは初期状態にリセットされることを確認する。
 */
describe('Property 7: 保存成功後のフォームリセット（飲んだ場所保持）', () => {
  beforeEach(() => {
    mockSaveDrinking.mockClear();
    mockSaveDrinking.mockResolvedValue({ success: true });
  });

  it('有効な入力データで保存成功後、飲んだ場所のみ保持され他は初期状態にリセットされる', async () => {
    await fc.assert(
      fc.asyncProperty(validDrinkingFormDataArb, async (formData) => {
        mockSaveDrinking.mockClear();
        mockSaveDrinking.mockResolvedValue({ success: true });

        const { result } = renderHook(() => useDrinkingForm());

        // handleChange で各フィールドを設定
        act(() => {
          result.current.handleChange('sakeName', formData.sakeName);
          result.current.handleChange('placeName', formData.placeName);
          result.current.handleChange('price', formData.price);
          result.current.handleChange('drinkingDate', formData.drinkingDate);
          result.current.handleChange('category', formData.category);
          result.current.handleChange('drinkingMethod', formData.drinkingMethod);
          result.current.handleChange('rating', formData.rating);
          result.current.handleChange('memo', formData.memo);
        });

        // 入力値が反映されていることを確認
        expect(result.current.formData.sakeName).toBe(formData.sakeName);
        expect(result.current.formData.placeName).toBe(formData.placeName);
        expect(result.current.formData.price).toBe(formData.price);
        expect(result.current.formData.drinkingDate).toBe(formData.drinkingDate);
        expect(result.current.formData.category).toBe(formData.category);
        expect(result.current.formData.drinkingMethod).toBe(formData.drinkingMethod);
        expect(result.current.formData.rating).toBe(formData.rating);
        expect(result.current.formData.memo).toBe(formData.memo);

        // handleSubmit を呼び出し
        await act(async () => {
          await result.current.handleSubmit();
        });

        // saveDrinking が呼ばれたことを確認
        expect(mockSaveDrinking).toHaveBeenCalledTimes(1);

        // 飲んだ場所のみ前回値が保持されていることを検証
        expect(result.current.formData.placeName).toBe(formData.placeName);

        // 他のフィールドは初期状態にリセットされていることを検証
        const initial = getInitialDrinkingFormData(formData.placeName);
        expect(result.current.formData.sakeName).toBe(initial.sakeName);
        expect(result.current.formData.price).toBe(initial.price);
        expect(result.current.formData.drinkingDate).toBe(initial.drinkingDate);
        expect(result.current.formData.category).toBe(initial.category);
        expect(result.current.formData.drinkingMethod).toBe(initial.drinkingMethod);
        expect(result.current.formData.rating).toBe(initial.rating);
        expect(result.current.formData.memo).toBe(initial.memo);
      }),
      { numRuns: 100 },
    );
  });
});



// Feature: sake-drinking-registration, Property 8: 保存失敗時の入力保持

/**
 * Property 8: 保存失敗時の入力保持
 * Validates: Requirements 3.5
 *
 * ランダムな有効入力データ + 保存失敗モックで全フィールドの入力値保持を検証する。
 * useDrinkingForm フックを renderHook でテストし、
 * handleChange で各フィールドを設定後、handleSubmit を呼び出し（保存失敗）、
 * フォームデータが送信前の入力値をそのまま保持していることを確認する。
 */
describe('Property 8: 保存失敗時の入力保持', () => {
  beforeEach(() => {
    mockSaveDrinking.mockClear();
    mockSaveDrinking.mockResolvedValue({
      success: false,
      error: '登録に失敗しました。もう一度お試しください',
    });
  });

  afterEach(() => {
    // 他のテストに影響しないよう、成功を返すデフォルトに戻す
    mockSaveDrinking.mockResolvedValue({ success: true });
  });

  it('有効な入力データで保存失敗後、フォームの入力値が保持される', async () => {
    await fc.assert(
      fc.asyncProperty(validDrinkingFormDataArb, async (formData) => {
        mockSaveDrinking.mockClear();
        mockSaveDrinking.mockResolvedValue({
          success: false,
          error: '登録に失敗しました。もう一度お試しください',
        });

        const { result } = renderHook(() => useDrinkingForm());

        // handleChange で各フィールドを設定
        act(() => {
          result.current.handleChange('sakeName', formData.sakeName);
          result.current.handleChange('placeName', formData.placeName);
          result.current.handleChange('price', formData.price);
          result.current.handleChange('drinkingDate', formData.drinkingDate);
          result.current.handleChange('category', formData.category);
          result.current.handleChange('drinkingMethod', formData.drinkingMethod);
          result.current.handleChange('rating', formData.rating);
          result.current.handleChange('memo', formData.memo);
        });

        // 入力値が反映されていることを確認
        expect(result.current.formData.sakeName).toBe(formData.sakeName);
        expect(result.current.formData.placeName).toBe(formData.placeName);
        expect(result.current.formData.price).toBe(formData.price);
        expect(result.current.formData.drinkingDate).toBe(formData.drinkingDate);
        expect(result.current.formData.category).toBe(formData.category);
        expect(result.current.formData.drinkingMethod).toBe(formData.drinkingMethod);
        expect(result.current.formData.rating).toBe(formData.rating);
        expect(result.current.formData.memo).toBe(formData.memo);

        // handleSubmit を呼び出し（保存は失敗する）
        await act(async () => {
          await result.current.handleSubmit();
        });

        // saveDrinking が呼ばれたことを確認
        expect(mockSaveDrinking).toHaveBeenCalledTimes(1);

        // 保存失敗後、フォームの入力値が保持されていることを検証
        expect(result.current.formData.sakeName).toBe(formData.sakeName);
        expect(result.current.formData.placeName).toBe(formData.placeName);
        expect(result.current.formData.price).toBe(formData.price);
        expect(result.current.formData.drinkingDate).toBe(formData.drinkingDate);
        expect(result.current.formData.category).toBe(formData.category);
        expect(result.current.formData.drinkingMethod).toBe(formData.drinkingMethod);
        expect(result.current.formData.rating).toBe(formData.rating);
        expect(result.current.formData.memo).toBe(formData.memo);

        // errorMessage にエラー情報が設定されていることを確認
        expect(result.current.errorMessage).toBe(
          '登録に失敗しました。もう一度お試しください',
        );
      }),
      { numRuns: 100 },
    );
  });
});



// Feature: sake-drinking-registration, Property 11: 連続登録時の成功メッセージ表示

/**
 * Property 11: 連続登録時の成功メッセージ表示
 * Validates: Requirements 5.2
 *
 * ランダムな回数（2〜10）の有効入力データで各登録後に成功メッセージが表示されることを検証する。
 * 単一の renderHook インスタンスで連続登録を行い、
 * 各登録ごとに successMessage が「登録が完了しました」であること、
 * フォームがリセットされること（飲んだ場所は保持）、
 * 最終的に mockSaveDrinking が N 回呼ばれることを確認する。
 */
describe('Property 11: 連続登録時の成功メッセージ表示', () => {
  beforeEach(() => {
    mockSaveDrinking.mockClear();
    mockSaveDrinking.mockResolvedValue({ success: true });
  });

  it('連続した有効な登録操作の各回で成功メッセージが表示される', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(validDrinkingFormDataArb, { minLength: 2, maxLength: 10 }),
        async (formDataArray) => {
          mockSaveDrinking.mockClear();
          mockSaveDrinking.mockResolvedValue({ success: true });

          const { result } = renderHook(() => useDrinkingForm());

          for (let i = 0; i < formDataArray.length; i++) {
            const formData = formDataArray[i];

            // handleChange で各フィールドを設定
            act(() => {
              result.current.handleChange('sakeName', formData.sakeName);
              result.current.handleChange('placeName', formData.placeName);
              result.current.handleChange('price', formData.price);
              result.current.handleChange('drinkingDate', formData.drinkingDate);
              result.current.handleChange('category', formData.category);
              result.current.handleChange('drinkingMethod', formData.drinkingMethod);
              result.current.handleChange('rating', formData.rating);
              result.current.handleChange('memo', formData.memo);
            });

            // handleSubmit を呼び出し
            await act(async () => {
              await result.current.handleSubmit();
            });

            // 各登録後に successMessage が表示されることを検証
            expect(result.current.successMessage).toBe('登録が完了しました');

            // フォームがリセットされていることを検証（飲んだ場所は保持）
            const initial = getInitialDrinkingFormData(formData.placeName);
            expect(result.current.formData.sakeName).toBe(initial.sakeName);
            expect(result.current.formData.placeName).toBe(formData.placeName);
            expect(result.current.formData.price).toBe(initial.price);
            expect(result.current.formData.drinkingDate).toBe(initial.drinkingDate);
            expect(result.current.formData.category).toBe(initial.category);
            expect(result.current.formData.drinkingMethod).toBe(initial.drinkingMethod);
            expect(result.current.formData.rating).toBe(initial.rating);
            expect(result.current.formData.memo).toBe(initial.memo);
          }

          // 全登録完了後、mockSaveDrinking が N 回呼ばれたことを確認
          expect(mockSaveDrinking).toHaveBeenCalledTimes(formDataArray.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
