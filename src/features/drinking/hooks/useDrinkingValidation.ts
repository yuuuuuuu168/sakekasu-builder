import { useState } from 'react';
import type { DrinkingFormData, DrinkingValidationErrors } from '../types';
import { DRINKING_METHODS_MAP } from '../types';
import { SAKE_CATEGORIES } from '../../purchase/types';
import type { SakeCategory } from '../../purchase/types';
import { getTodayString } from '@/lib/dateUtils';

export interface UseDrinkingValidationReturn {
  errors: DrinkingValidationErrors;
  validateField: (field: keyof DrinkingFormData, value: string | number) => string | undefined;
  validateAll: (data: DrinkingFormData) => DrinkingValidationErrors;
  isValid: (data: DrinkingFormData) => boolean;
  clearErrors: () => void;
}

/**
 * Rating値を1〜5の範囲にクランプする
 * 0以下は1に、6以上は5にクランプ
 */
export function clampRating(value: number): number {
  if (value <= 0) return 1;
  if (value >= 6) return 5;
  return value;
}

function validateSakeName(value: string | number): string | undefined {
  const str = String(value);
  if (!str || str.trim().length === 0) {
    return '銘柄名は必須です';
  }
  return undefined;
}

function validatePlaceName(value: string | number): string | undefined {
  const str = String(value);
  if (!str || str.trim().length === 0) {
    return '飲んだ場所は必須です';
  }
  return undefined;
}

function validatePrice(value: string | number): string | undefined {
  const str = String(value);
  // 価格は任意フィールド: 空文字はOK
  if (str === '' || str.trim().length === 0) {
    return undefined;
  }
  const num = Number(str);
  if (!Number.isFinite(num) || num < 0 || !Number.isInteger(num)) {
    return '価格は0以上の数値で入力してください';
  }
  return undefined;
}

function validateDrinkingDate(value: string | number): string | undefined {
  const str = String(value);
  if (!str || str.trim().length === 0) {
    return '飲んだ日は必須です';
  }
  const today = getTodayString();
  if (str > today) {
    return '飲んだ日は本日以前の日付を入力してください';
  }
  return undefined;
}

function validateCategory(value: string | number): string | undefined {
  const str = String(value);
  if (!str || !SAKE_CATEGORIES.includes(str as SakeCategory)) {
    return 'カテゴリは必須です';
  }
  return undefined;
}

function validateDrinkingMethod(value: string | number): string | undefined {
  const str = String(value);
  // '-' は飲み方不要カテゴリの固定値として許可
  if (str === '-') {
    return undefined;
  }
  if (!str || str.trim().length === 0) {
    return '飲み方は必須です';
  }
  // 全カテゴリの飲み方リストに含まれているか確認
  const allMethods = Object.values(DRINKING_METHODS_MAP).flat();
  if (!allMethods.includes(str)) {
    return '飲み方は必須です';
  }
  return undefined;
}

function validateRating(value: string | number): string | undefined {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num < 1 || num > 5 || !Number.isInteger(num)) {
    return '評価を選択してください';
  }
  return undefined;
}

const validators: Record<
  keyof DrinkingFormData,
  (value: string | number) => string | undefined
> = {
  sakeName: validateSakeName,
  placeName: validatePlaceName,
  price: validatePrice,
  drinkingDate: validateDrinkingDate,
  category: validateCategory,
  drinkingMethod: validateDrinkingMethod,
  rating: validateRating,
  memo: () => undefined,
};

export function useDrinkingValidation(): UseDrinkingValidationReturn {
  const [errors, setErrors] = useState<DrinkingValidationErrors>({});

  const validateField = (
    field: keyof DrinkingFormData,
    value: string | number,
  ): string | undefined => {
    const error = validators[field](value);
    setErrors((prev) => {
      const next = { ...prev };
      if (error) {
        next[field as keyof DrinkingValidationErrors] = error;
      } else {
        delete next[field as keyof DrinkingValidationErrors];
      }
      return next;
    });
    return error;
  };

  const validateAll = (data: DrinkingFormData): DrinkingValidationErrors => {
    const newErrors: DrinkingValidationErrors = {};
    for (const field of Object.keys(validators) as (keyof DrinkingFormData)[]) {
      if (field === 'memo') continue;
      const error = validators[field](data[field]);
      if (error) {
        newErrors[field as keyof DrinkingValidationErrors] = error;
      }
    }
    setErrors(newErrors);
    return newErrors;
  };

  const isValid = (data: DrinkingFormData): boolean => {
    const newErrors = validateAll(data);
    return Object.keys(newErrors).length === 0;
  };

  const clearErrors = (): void => {
    setErrors({});
  };

  return { errors, validateField, validateAll, isValid, clearErrors };
}
