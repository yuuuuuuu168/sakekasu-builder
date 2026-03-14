import { useState, useCallback } from 'react';
import type { PurchaseFormData, SaveResult } from '@/features/purchase/types';
import { useFormValidation } from '@/features/purchase/hooks/useFormValidation';
import { usePurchaseStorage } from '@/features/purchase/hooks/usePurchaseStorage';
import type { UseFormValidationReturn } from '@/features/purchase/hooks/useFormValidation';
import type { UsePurchaseStorageReturn } from '@/features/purchase/hooks/usePurchaseStorage';

export interface UsePurchaseFormReturn {
  formData: PurchaseFormData;
  errors: UseFormValidationReturn['errors'];
  isSaving: UsePurchaseStorageReturn['isSaving'];
  submitResult: SaveResult | null;
  handleChange: (field: keyof PurchaseFormData, value: string) => void;
  handleBlur: (field: keyof PurchaseFormData) => void;
  handleSubmit: () => Promise<void>;
}

function getTodayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getInitialFormData(): PurchaseFormData {
  return {
    sakeName: '',
    storeName: '',
    price: '',
    purchaseDate: getTodayString(),
    category: 'NIHONSHU',
    memo: '',
  };
}

export function usePurchaseForm(): UsePurchaseFormReturn {
  const [formData, setFormData] = useState<PurchaseFormData>(getInitialFormData);
  const [submitResult, setSubmitResult] = useState<SaveResult | null>(null);

  const { errors, validateField, isValid, clearErrors } = useFormValidation();
  const { savePurchase, isSaving } = usePurchaseStorage();

  const handleChange = useCallback(
    (field: keyof PurchaseFormData, value: string) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleBlur = useCallback(
    (field: keyof PurchaseFormData) => {
      validateField(field, formData[field]);
    },
    [validateField, formData],
  );

  const handleSubmit = useCallback(async () => {
    setSubmitResult(null);

    if (!isValid(formData)) {
      return;
    }

    const result = await savePurchase(formData);

    if (result.success) {
      setFormData(getInitialFormData());
      clearErrors();
      setSubmitResult({ success: true });
    } else {
      setSubmitResult(result);
    }
  }, [formData, isValid, savePurchase, clearErrors]);

  return {
    formData,
    errors,
    isSaving,
    submitResult,
    handleChange,
    handleBlur,
    handleSubmit,
  };
}
