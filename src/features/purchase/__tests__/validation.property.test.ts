import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as fc from 'fast-check';
import { useFormValidation } from '@/features/purchase/hooks/useFormValidation';
import type { PurchaseFormData } from '@/features/purchase/types';
import { SAKE_CATEGORIES } from '@/features/purchase/types';

// Feature: sake-purchase-registration, Property 1: 必須フィールド空欄バリデーション

/** 本日の日付文字列を返す */
function getTodayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 有効なベースフォームデータを生成する */
function validBaseData(): PurchaseFormData {
  return {
    sakeName: '獺祭',
    storeName: '酒のやまや',
    price: '3000',
    quantity: '1',
    purchaseDate: getTodayString(),
    category: 'NIHONSHU',
    memo: '',
  };
}

/** 空文字または空白のみの文字列を生成するArbitrary */
const emptyOrWhitespaceArb = fc.oneof(
  fc.constant(''),
  fc.integer({ min: 1, max: 5 }).map((n) => ' '.repeat(n)),
);

const REQUIRED_FIELDS = ['sakeName', 'storeName', 'price', 'quantity', 'purchaseDate', 'category'] as const;
type RequiredField = (typeof REQUIRED_FIELDS)[number];

/**
 * Property 1: 必須フィールド空欄バリデーション
 * Validates: Requirements 2.1
 *
 * 必須フィールドのランダムな部分集合を空にした入力データで
 * バリデーション失敗を検証する。
 */
describe('Property 1: 必須フィールド空欄バリデーション', () => {
  it('必須フィールドのランダムな部分集合を空にした場合、バリデーションが失敗する', () => {
    fc.assert(
      fc.property(
        // 必須フィールドの非空部分集合を生成
        fc
          .shuffledSubarray([...REQUIRED_FIELDS], { minLength: 1 })
          .chain((fields) =>
            fc.tuple(
              fc.constant(fields),
              // 各フィールドに対して空文字または空白のみの値を生成
              fc.tuple(...fields.map(() => emptyOrWhitespaceArb)),
            ),
          ),
        ([fieldsToEmpty, emptyValues]) => {
          const { result } = renderHook(() => useFormValidation());

          // 有効なベースデータを作成
          const formData: PurchaseFormData = validBaseData();

          // 選択されたフィールドを空にする
          fieldsToEmpty.forEach((field, index) => {
            (formData as Record<string, string>)[field] = emptyValues[index];
          });

          // validateAll を実行
          let errors: Record<string, string | undefined> = {};
          act(() => {
            errors = result.current.validateAll(formData);
          });

          // 空にした全フィールドにエラーが設定されていることを検証
          for (const field of fieldsToEmpty) {
            expect(
              errors[field],
              `フィールド "${field}" にエラーが設定されるべき (値: "${formData[field]}")`,
            ).toBeDefined();
          }

          // isValid が false を返すことを検証
          let valid = true;
          act(() => {
            valid = result.current.isValid(formData);
          });
          expect(valid).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// Feature: sake-purchase-registration, Property 2: 無効な価格入力バリデーション

/**
 * Property 2: 無効な価格入力バリデーション
 * Validates: Requirements 2.2, 2.3
 *
 * 非数値文字列・負の数値・小数でバリデーション失敗と
 * エラーメッセージ「価格は0以上の数値で入力してください」を検証する。
 */
describe('Property 2: 無効な価格入力バリデーション', () => {
  const PRICE_ERROR_MESSAGE = '価格は0以上の数値で入力してください';

  /** 数値として解釈できない文字列を生成するArbitrary */
  const nonNumericStringArb = fc.oneof(
    // ランダム文字列から有効な数値文字列を除外
    fc.string({ minLength: 1 }).filter((s) => {
      const n = Number(s);
      return !Number.isFinite(n) || s.trim().length === 0;
    }),
    // 通貨記号付き文字列
    fc.nat().map((n) => `¥${n}`),
    fc.nat().map((n) => `$${n}`),
    // 日本語テキスト・特殊文字
    fc.constantFrom('百', '千円', 'ten', 'abc', '価格', '!@#', '1,000', '1.2.3', '1e', '--1', '++1', '1a2'),
  );

  /** 負の整数を文字列として生成するArbitrary */
  const negativeIntegerArb = fc.integer({ min: -1000000, max: -1 }).map(String);

  /** 小数を文字列として生成するArbitrary（整数でない有限の数値） */
  const nonIntegerDecimalArb = fc
    .double({ min: 0.01, max: 999999.99, noNaN: true, noDefaultInfinity: true })
    .filter((n) => !Number.isInteger(n))
    .map(String);

  it('非数値文字列で価格バリデーションが失敗し、正しいエラーメッセージが返る', () => {
    fc.assert(
      fc.property(nonNumericStringArb, (invalidPrice) => {
        const { result } = renderHook(() => useFormValidation());

        // validateField で個別検証
        let fieldError: string | undefined;
        act(() => {
          fieldError = result.current.validateField('price', invalidPrice);
        });
        expect(fieldError).toBe(PRICE_ERROR_MESSAGE);

        // validateAll で全体検証
        const formData: PurchaseFormData = {
          ...validBaseData(),
          price: invalidPrice,
        };
        let errors: Record<string, string | undefined> = {};
        act(() => {
          errors = result.current.validateAll(formData);
        });
        expect(errors.price).toBe(PRICE_ERROR_MESSAGE);
      }),
      { numRuns: 100 },
    );
  });

  it('負の数値で価格バリデーションが失敗し、正しいエラーメッセージが返る', () => {
    fc.assert(
      fc.property(negativeIntegerArb, (negativePrice) => {
        const { result } = renderHook(() => useFormValidation());

        // validateField で個別検証
        let fieldError: string | undefined;
        act(() => {
          fieldError = result.current.validateField('price', negativePrice);
        });
        expect(fieldError).toBe(PRICE_ERROR_MESSAGE);

        // validateAll で全体検証
        const formData: PurchaseFormData = {
          ...validBaseData(),
          price: negativePrice,
        };
        let errors: Record<string, string | undefined> = {};
        act(() => {
          errors = result.current.validateAll(formData);
        });
        expect(errors.price).toBe(PRICE_ERROR_MESSAGE);
      }),
      { numRuns: 100 },
    );
  });

  it('小数で価格バリデーションが失敗し、正しいエラーメッセージが返る', () => {
    fc.assert(
      fc.property(nonIntegerDecimalArb, (decimalPrice) => {
        const { result } = renderHook(() => useFormValidation());

        // validateField で個別検証
        let fieldError: string | undefined;
        act(() => {
          fieldError = result.current.validateField('price', decimalPrice);
        });
        expect(fieldError).toBe(PRICE_ERROR_MESSAGE);

        // validateAll で全体検証
        const formData: PurchaseFormData = {
          ...validBaseData(),
          price: decimalPrice,
        };
        let errors: Record<string, string | undefined> = {};
        act(() => {
          errors = result.current.validateAll(formData);
        });
        expect(errors.price).toBe(PRICE_ERROR_MESSAGE);
      }),
      { numRuns: 100 },
    );
  });
});


// Feature: sake-purchase-registration, Property 3: 未来日付バリデーション

/**
 * Property 3: 未来日付バリデーション
 * Validates: Requirements 2.4
 *
 * 明日以降のランダムな日付でバリデーション失敗と
 * エラーメッセージ「購入日は本日以前の日付を入力してください」を検証する。
 */
describe('Property 3: 未来日付バリデーション', () => {
  const DATE_ERROR_MESSAGE = '購入日は本日以前の日付を入力してください';

  /** 明日から10年後までのランダムな未来日付をYYYY-MM-DD形式で生成するArbitrary */
  const futureDateArb = fc
    .integer({ min: 1, max: 365 * 10 })
    .map((daysFromNow) => {
      const future = new Date();
      future.setDate(future.getDate() + daysFromNow);
      const year = future.getFullYear();
      const month = String(future.getMonth() + 1).padStart(2, '0');
      const day = String(future.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    });

  it('未来の日付で購入日バリデーションが失敗し、正しいエラーメッセージが返る', () => {
    fc.assert(
      fc.property(futureDateArb, (futureDate) => {
        const { result } = renderHook(() => useFormValidation());

        // validateField で個別検証
        let fieldError: string | undefined;
        act(() => {
          fieldError = result.current.validateField('purchaseDate', futureDate);
        });
        expect(fieldError).toBe(DATE_ERROR_MESSAGE);

        // validateAll で全体検証
        const formData: PurchaseFormData = {
          ...validBaseData(),
          purchaseDate: futureDate,
        };
        let errors: Record<string, string | undefined> = {};
        act(() => {
          errors = result.current.validateAll(formData);
        });
        expect(errors.purchaseDate).toBe(DATE_ERROR_MESSAGE);
      }),
      { numRuns: 100 },
    );
  });
});


// Feature: sake-purchase-registration, Property 4: 有効入力のバリデーション通過

/**
 * Property 4: 有効入力のバリデーション通過
 * Validates: Requirements 2.5
 *
 * 全フィールドが有効なランダム入力データでバリデーション成功を検証する。
 */
describe('Property 4: 有効入力のバリデーション通過', () => {
  /** 非空・非空白のみの文字列を生成するArbitrary */
  const nonEmptyNonWhitespaceArb = fc
    .string({ minLength: 1 })
    .filter((s) => s.trim().length > 0);

  /** 0以上の整数を文字列として生成するArbitrary */
  const nonNegativeIntegerPriceArb = fc.nat().map(String);

  /** 1以上の整数（本数）を文字列として生成するArbitrary */
  const positiveIntegerQuantityArb = fc.integer({ min: 1, max: 9999 }).map(String);

  /** 本日以前のランダムな日付をYYYY-MM-DD形式で生成するArbitrary */
  const pastDateArb = fc
    .integer({ min: 0, max: 365 * 10 })
    .map((daysAgo) => {
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
    quantity: positiveIntegerQuantityArb,
    purchaseDate: pastDateArb,
    category: categoryArb,
    memo: memoArb,
  }) as fc.Arbitrary<PurchaseFormData>;

  it('全フィールドが有効な入力データでバリデーションが成功する', () => {
    fc.assert(
      fc.property(validFormDataArb, (formData) => {
        const { result } = renderHook(() => useFormValidation());

        // validateAll を実行
        let errors: Record<string, string | undefined> = {};
        act(() => {
          errors = result.current.validateAll(formData);
        });

        // エラーが空であることを検証
        expect(
          Object.keys(errors).length,
          `有効なデータでエラーが発生: ${JSON.stringify(errors)} (入力: ${JSON.stringify(formData)})`,
        ).toBe(0);

        // isValid が true を返すことを検証
        let valid = false;
        act(() => {
          valid = result.current.isValid(formData);
        });
        expect(valid).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
