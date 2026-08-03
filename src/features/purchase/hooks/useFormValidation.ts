import { useState } from 'react';
import type {
  PurchaseFormData,
  ValidationErrors,
  SakeCategory,
} from '@/features/purchase/types';
import { SAKE_CATEGORIES } from '@/features/purchase/types';
import { getTodayString } from '@/lib/dateUtils';

export interface UseFormValidationReturn {
  errors: ValidationErrors;
  validateField: (field: keyof PurchaseFormData, value: string) => string | undefined;
  validateAll: (data: PurchaseFormData) => ValidationErrors;
  isValid: (data: PurchaseFormData) => boolean;
  clearErrors: () => void;
}

function validateSakeName(value: string): string | undefined {
  if (!value || value.trim().length === 0) {
    return '銘柄名は必須です';
  }
  return undefined;
}

function validateStoreName(value: string): string | undefined {
  if (!value || value.trim().length === 0) {
    return '購入店舗名は必須です';
  }
  return undefined;
}

function validatePrice(value: string): string | undefined {
  if (!value || value.trim().length === 0) {
    return '価格は0以上の数値で入力してください';
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || !Number.isInteger(num)) {
    return '価格は0以上の数値で入力してください';
  }
  return undefined;
}

function validateQuantity(value: string): string | undefined {
  if (!value || value.trim().length === 0) {
    return '本数は1以上の整数で入力してください';
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 1 || !Number.isInteger(num)) {
    return '本数は1以上の整数で入力してください';
  }
  return undefined;
}

function validatePurchaseDate(value: string): string | undefined {
  if (!value || value.trim().length === 0) {
    return '購入日は必須です';
  }
  const today = getTodayString();
  if (value > today) {
    return '購入日は本日以前の日付を入力してください';
  }
  return undefined;
}

function validateCategory(value: string): string | undefined {
  if (!value || !SAKE_CATEGORIES.includes(value as SakeCategory)) {
    return 'カテゴリは必須です';
  }
  return undefined;
}

const validators: Record<
  keyof PurchaseFormData,
  (value: string) => string | undefined
> = {
  sakeName: validateSakeName,
  storeName: validateStoreName,
  price: validatePrice,
  quantity: validateQuantity,
  purchaseDate: validatePurchaseDate,
  category: validateCategory,
  memo: () => undefined,
};

export function useFormValidation(): UseFormValidationReturn {
  const [errors, setErrors] = useState<ValidationErrors>({});

  const validateField = (
    field: keyof PurchaseFormData,
    value: string,
  ): string | undefined => {
    const error = validators[field](value);
    setErrors((prev) => {
      const next = { ...prev };
      if (error) {
        next[field as keyof ValidationErrors] = error;
      } else {
        delete next[field as keyof ValidationErrors];
      }
      return next;
    });
    return error;
  };

  const validateAll = (data: PurchaseFormData): ValidationErrors => {
    const newErrors: ValidationErrors = {};
    for (const field of Object.keys(validators) as (keyof PurchaseFormData)[]) {
      if (field === 'memo') continue;
      const error = validators[field](data[field]);
      if (error) {
        newErrors[field as keyof ValidationErrors] = error;
      }
    }
    setErrors(newErrors);
    return newErrors;
  };

  const isValid = (data: PurchaseFormData): boolean => {
    const newErrors = validateAll(data);
    return Object.keys(newErrors).length === 0;
  };

  const clearErrors = (): void => {
    setErrors({});
  };

  return { errors, validateField, validateAll, isValid, clearErrors };
}
