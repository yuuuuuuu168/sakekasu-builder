import type { DrinkingFormData, DrinkingValidationErrors } from '../types';
import { DRINKING_METHODS_MAP } from '../types';
import {
  integerAtLeast,
  noValidation,
  notFutureDate,
  required,
  sakeCategory,
  useFieldValidation,
} from '@/lib/formValidation';
import type { FieldValidator, UseFieldValidationReturn } from '@/lib/formValidation';

export type UseDrinkingValidationReturn = UseFieldValidationReturn<
  DrinkingFormData,
  DrinkingValidationErrors
>;

/** 全カテゴリの飲み方。カテゴリとの組み合わせは画面側の選択肢で絞っている */
const ALL_DRINKING_METHODS = Object.values(DRINKING_METHODS_MAP).flat();

function validateDrinkingMethod(value: string | number): string | undefined {
  const str = String(value);
  // '-' は飲み方不要カテゴリの固定値として許可
  if (str === '-') return undefined;
  return ALL_DRINKING_METHODS.includes(str) ? undefined : '飲み方は必須です';
}

function validateRating(value: string | number): string | undefined {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num < 1 || num > 5 || !Number.isInteger(num)) {
    return '評価を選択してください';
  }
  return undefined;
}

const validators: Record<keyof DrinkingFormData, FieldValidator> = {
  sakeName: required('銘柄名は必須です'),
  placeName: required('飲んだ場所は必須です'),
  // 価格は任意。空は通す
  price: integerAtLeast(0, '価格は0以上の数値で入力してください', { optional: true }),
  drinkingDate: notFutureDate('飲んだ日は必須です', '飲んだ日は本日以前の日付を入力してください'),
  category: sakeCategory(),
  drinkingMethod: validateDrinkingMethod,
  rating: validateRating,
  memo: noValidation,
};

export function useDrinkingValidation(): UseDrinkingValidationReturn {
  return useFieldValidation<DrinkingFormData, DrinkingValidationErrors>(validators);
}
