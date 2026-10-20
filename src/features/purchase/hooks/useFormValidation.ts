import type { PurchaseFormData, ValidationErrors } from '@/features/purchase/types';
import {
  integerAtLeast,
  noValidation,
  notFutureDate,
  required,
  sakeCategory,
  useFieldValidation,
} from '@/lib/formValidation';
import type { FieldValidator, UseFieldValidationReturn } from '@/lib/formValidation';

export type UseFormValidationReturn = UseFieldValidationReturn<PurchaseFormData, ValidationErrors>;

const validators: Record<keyof PurchaseFormData, FieldValidator> = {
  sakeName: required('銘柄名は必須です'),
  storeName: required('購入店舗名は必須です'),
  price: integerAtLeast(0, '価格は0以上の数値で入力してください'),
  quantity: integerAtLeast(1, '本数は1以上の整数で入力してください'),
  purchaseDate: notFutureDate('購入日は必須です', '購入日は本日以前の日付を入力してください'),
  category: sakeCategory(),
  memo: noValidation,
};

export function useFormValidation(): UseFormValidationReturn {
  return useFieldValidation<PurchaseFormData, ValidationErrors>(validators);
}
