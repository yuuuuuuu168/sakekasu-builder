import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as fc from 'fast-check';
import { SAKE_CATEGORIES } from '@/features/purchase/types';
import type { SakeCategory } from '@/features/purchase/types';
import type { DrinkingFormData } from '../types';
import { DRINKING_METHODS_MAP } from '../types';
import { useDrinkingValidation, clampRating } from '../hooks/useDrinkingValidation';

// ============================================================
// ヘルパー
// ============================================================

/** 本日の日付文字列を返す */
function getTodayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 有効なベースフォームデータを生成する */
function validBaseData(): DrinkingFormData {
  return {
    sakeName: '獺祭',
    placeName: '居酒屋たろう',
    price: '500',
    drinkingDate: getTodayString(),
    category: 'NIHONSHU',
    drinkingMethod: '冷酒',
    rating: 4,
    memo: '',
  };
}

/** 空文字または空白のみの文字列を生成するArbitrary */
const emptyOrWhitespaceArb = fc.oneof(
  fc.constant(''),
  fc.integer({ min: 1, max: 5 }).map((n) => ' '.repeat(n)),
);

/** 有効な DrinkingFormData を生成する Arbitrary */
const sakeCategoryArb = fc.constantFrom(...SAKE_CATEGORIES);

const validDrinkingFormDataArb = sakeCategoryArb.chain((category) => {
  const methods = DRINKING_METHODS_MAP[category];
  const drinkingMethodArb = methods.length > 0
    ? fc.constantFrom(...methods)
    : fc.constant('-');
  return fc.record({
    sakeName: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
    placeName: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
    price: fc.oneof(fc.constant(''), fc.nat().map(String)),
    drinkingDate: fc
      .date({
        min: new Date('2000-01-01T00:00:00.000Z'),
        max: new Date(),
      })
      .filter((d) => !isNaN(d.getTime()))
      .map((d) => d.toISOString().split('T')[0]),
    category: fc.constant(category as string),
    drinkingMethod: drinkingMethodArb,
    rating: fc.integer({ min: 1, max: 5 }),
    memo: fc.string(),
  }) as fc.Arbitrary<DrinkingFormData>;
});


// ============================================================
// Feature: sake-drinking-registration, Property 2: 必須フィールド空欄バリデーション
// ============================================================

const REQUIRED_FIELDS = [
  'sakeName',
  'placeName',
  'drinkingDate',
  'category',
  'drinkingMethod',
  'rating',
] as const;
type RequiredField = (typeof REQUIRED_FIELDS)[number];

/**
 * Property 2: 必須フィールド空欄バリデーション
 * **Validates: Requirements 2.1**
 *
 * 必須フィールド（銘柄名、飲んだ場所、飲んだ日、Sake_Category、Drinking_Method、
 * Serving_Style、Rating）のランダムな部分集合を空にした入力データで
 * バリデーション失敗を検証する。
 */
describe('Property 2: 必須フィールド空欄バリデーション', () => {
  it('必須フィールドのランダムな部分集合を空にした場合、バリデーションが失敗する', () => {
    fc.assert(
      fc.property(
        fc
          .shuffledSubarray([...REQUIRED_FIELDS], { minLength: 1 })
          .chain((fields) =>
            fc.tuple(
              fc.constant(fields),
              fc.tuple(...fields.map(() => emptyOrWhitespaceArb)),
            ),
          ),
        ([fieldsToEmpty, emptyValues]) => {
          const { result } = renderHook(() => useDrinkingValidation());

          const formData: DrinkingFormData = validBaseData();

          // 選択されたフィールドを空にする
          fieldsToEmpty.forEach((field, index) => {
            if (field === 'rating') {
              // rating は number なので 0（未選択）に設定
              (formData as Record<string, unknown>)[field] = 0;
            } else {
              (formData as Record<string, unknown>)[field] = emptyValues[index];
            }
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
              `フィールド "${field}" にエラーが設定されるべき`,
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


// ============================================================
// Feature: sake-drinking-registration, Property 3: 無効な価格入力バリデーション
// ============================================================

/**
 * Property 3: 無効な価格入力バリデーション
 * **Validates: Requirements 2.2, 2.3**
 *
 * 非数値文字列・負の数値でバリデーション失敗と
 * 「価格は0以上の数値で入力してください」エラーメッセージを検証する。
 */
describe('Property 3: 無効な価格入力バリデーション', () => {
  const PRICE_ERROR_MESSAGE = '価格は0以上の数値で入力してください';

  /** 数値として解釈できない文字列を生成するArbitrary（空白のみは未入力扱いなので除外） */
  const nonNumericStringArb = fc.oneof(
    fc.string({ minLength: 1 }).filter((s) => {
      const n = Number(s);
      return !Number.isFinite(n) && s.trim().length > 0;
    }),
    fc.constantFrom('百', '千円', 'abc', '!@#', '1,000', '1.2.3', '1e', '--1', '++1', '1a2'),
  );

  /** 負の整数を文字列として生成するArbitrary */
  const negativeIntegerArb = fc.integer({ min: -1000000, max: -1 }).map(String);

  it('非数値文字列で価格バリデーションが失敗し、正しいエラーメッセージが返る', () => {
    fc.assert(
      fc.property(nonNumericStringArb, (invalidPrice) => {
        const { result } = renderHook(() => useDrinkingValidation());

        const formData: DrinkingFormData = {
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
        const { result } = renderHook(() => useDrinkingValidation());

        const formData: DrinkingFormData = {
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
});


// ============================================================
// Feature: sake-drinking-registration, Property 4: 未来日付バリデーション
// ============================================================

/**
 * Property 4: 未来日付バリデーション
 * **Validates: Requirements 2.4**
 *
 * 明日以降のランダムな日付でバリデーション失敗と
 * 「飲んだ日は本日以前の日付を入力してください」エラーメッセージを検証する。
 */
describe('Property 4: 未来日付バリデーション', () => {
  const DATE_ERROR_MESSAGE = '飲んだ日は本日以前の日付を入力してください';

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

  it('未来の日付で飲んだ日バリデーションが失敗し、正しいエラーメッセージが返る', () => {
    fc.assert(
      fc.property(futureDateArb, (futureDate) => {
        const { result } = renderHook(() => useDrinkingValidation());

        const formData: DrinkingFormData = {
          ...validBaseData(),
          drinkingDate: futureDate,
        };
        let errors: Record<string, string | undefined> = {};
        act(() => {
          errors = result.current.validateAll(formData);
        });
        expect(errors.drinkingDate).toBe(DATE_ERROR_MESSAGE);
      }),
      { numRuns: 100 },
    );
  });
});


// ============================================================
// Feature: sake-drinking-registration, Property 5: Rating範囲制限
// ============================================================

/**
 * Property 5: Rating範囲制限
 * **Validates: Requirements 2.5**
 *
 * 1〜5の範囲外のランダムな整数値がクランプされることを検証
 * （0以下は1に、6以上は5に）。
 */
describe('Property 5: Rating範囲制限', () => {
  /** 0以下のランダムな整数を生成するArbitrary */
  const belowRangeArb = fc.integer({ min: -1000, max: 0 });

  /** 6以上のランダムな整数を生成するArbitrary */
  const aboveRangeArb = fc.integer({ min: 6, max: 1000 });

  it('0以下の値は1にクランプされる', () => {
    fc.assert(
      fc.property(belowRangeArb, (value) => {
        expect(clampRating(value)).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  it('6以上の値は5にクランプされる', () => {
    fc.assert(
      fc.property(aboveRangeArb, (value) => {
        expect(clampRating(value)).toBe(5);
      }),
      { numRuns: 100 },
    );
  });

  it('1〜5の範囲内の値はそのまま返される', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (value) => {
        expect(clampRating(value)).toBe(value);
      }),
      { numRuns: 100 },
    );
  });
});


// ============================================================
// Feature: sake-drinking-registration, Property 6: 有効入力のバリデーション通過
// ============================================================

/**
 * Property 6: 有効入力のバリデーション通過
 * **Validates: Requirements 2.6**
 *
 * 全フィールドが有効なランダム入力データ（銘柄名・場所名が非空白文字列、
 * 飲んだ日が本日以前、カテゴリが有効な列挙値、飲み方がカテゴリに対応する値、
 * 提供形態が有効な列挙値、Ratingが1〜5、価格が未入力または0以上の整数）で
 * バリデーション成功を検証する。
 */
describe('Property 6: 有効入力のバリデーション通過', () => {
  it('全フィールドが有効な入力データでバリデーションが成功する', () => {
    fc.assert(
      fc.property(validDrinkingFormDataArb, (formData) => {
        const { result } = renderHook(() => useDrinkingValidation());

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
