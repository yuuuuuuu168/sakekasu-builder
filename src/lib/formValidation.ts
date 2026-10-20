import { useState } from 'react';
import { SAKE_CATEGORIES } from '@/features/purchase/types';
import type { SakeCategory } from '@/features/purchase/types';
import { getTodayString } from '@/lib/dateUtils';

/**
 * 購入・飲酒フォームの入力チェックの部品。
 *
 * どちらのフォームも「項目ごとの検査関数の表」を持ち、その表で 1 項目ずつ・全項目を
 * 検査してエラー表示を更新する。表を作る部品と、表を回すフックをここにまとめる。
 */

/** 1 項目の検査。エラーがあればその文言を返す */
export type FieldValidator = (value: string | number) => string | undefined;

const isBlank = (value: string | number): boolean => String(value).trim().length === 0;

/** 空でないこと */
export function required(message: string): FieldValidator {
  return (value) => (isBlank(value) ? message : undefined);
}

/**
 * 整数で、下限以上であること。
 * optional なら空は通す（任意項目の価格など）
 */
export function integerAtLeast(
  min: number,
  message: string,
  { optional = false }: { optional?: boolean } = {},
): FieldValidator {
  return (value) => {
    if (isBlank(value)) return optional ? undefined : message;
    const num = Number(value);
    if (!Number.isFinite(num) || num < min || !Number.isInteger(num)) return message;
    return undefined;
  };
}

/** 空でなく、今日より後の日付でないこと（値は YYYY-MM-DD） */
export function notFutureDate(requiredMessage: string, futureMessage: string): FieldValidator {
  return (value) => {
    if (isBlank(value)) return requiredMessage;
    return String(value) > getTodayString() ? futureMessage : undefined;
  };
}

/** 酒のカテゴリのどれかであること */
export function sakeCategory(): FieldValidator {
  return (value) =>
    SAKE_CATEGORIES.includes(String(value) as SakeCategory) ? undefined : 'カテゴリは必須です';
}

/** 検査しない項目（備考など） */
export const noValidation: FieldValidator = () => undefined;

export interface UseFieldValidationReturn<T, E> {
  errors: E;
  validateField: (field: keyof T, value: T[keyof T]) => string | undefined;
  validateAll: (data: T) => E;
  isValid: (data: T) => boolean;
  clearErrors: () => void;
}

/**
 * 検査関数の表を回して、エラー表示の状態を持つ。
 * 表はモジュールの定数で渡す（描画のたびに作り直さない）
 */
export function useFieldValidation<T extends { [K in keyof T]: string | number }, E extends object>(
  validators: Record<keyof T, FieldValidator>,
): UseFieldValidationReturn<T, E> {
  const [errors, setErrors] = useState<E>({} as E);

  const validateField = (field: keyof T, value: T[keyof T]): string | undefined => {
    const error = validators[field](value);
    setErrors((prev) => {
      const next = { ...prev } as Record<string, string | undefined>;
      if (error) {
        next[field as string] = error;
      } else {
        delete next[field as string];
      }
      return next as E;
    });
    return error;
  };

  const validateAll = (data: T): E => {
    const newErrors: Record<string, string> = {};
    for (const field of Object.keys(validators) as (keyof T)[]) {
      const error = validators[field](data[field]);
      if (error) {
        newErrors[field as string] = error;
      }
    }
    setErrors(newErrors as E);
    return newErrors as E;
  };

  const isValid = (data: T): boolean => Object.keys(validateAll(data)).length === 0;

  const clearErrors = (): void => {
    setErrors({} as E);
  };

  return { errors, validateField, validateAll, isValid, clearErrors };
}
