import { useState, useCallback } from 'react';
import type { PurchaseFormData, SaveResult } from '@/features/purchase/types';
import { useFormValidation } from '@/features/purchase/hooks/useFormValidation';
import { usePurchaseStorage } from '@/features/purchase/hooks/usePurchaseStorage';
import { useImageUpload } from '@/features/image/hooks/useImageUpload';
import type { UseFormValidationReturn } from '@/features/purchase/hooks/useFormValidation';
import type { UsePurchaseStorageReturn } from '@/features/purchase/hooks/usePurchaseStorage';
import type { UseImageUploadReturn } from '@/features/image/hooks/useImageUpload';

export interface UsePurchaseFormReturn {
  formData: PurchaseFormData;
  errors: UseFormValidationReturn['errors'];
  isSaving: UsePurchaseStorageReturn['isSaving'];
  submitResult: SaveResult | null;
  handleChange: (field: keyof PurchaseFormData, value: string) => void;
  handleBlur: (field: keyof PurchaseFormData) => void;
  handleSubmit: () => Promise<void>;
  /** 画像アップロード関連 */
  imageUpload: UseImageUploadReturn;
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
  const imageUpload = useImageUpload();

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

    // 画像がある場合はアップロードを先に実行
    let imageKey: string | null = null;
    if (imageUpload.imageFile) {
      const recordId = crypto.randomUUID();
      const key = await imageUpload.uploadImage('purchase', recordId);
      if (key === null) {
        // アップロード失敗 → エラーは useImageUpload 側で設定済み、入力内容を保持
        return;
      }
      imageKey = key;
    }

    const result = await savePurchase(formData, { imageKey });

    if (result.success) {
      setFormData(getInitialFormData());
      clearErrors();
      imageUpload.clearImage();
      setSubmitResult({ success: true });
    } else {
      setSubmitResult(result);
    }
  }, [formData, isValid, savePurchase, clearErrors, imageUpload]);

  return {
    formData,
    errors,
    isSaving,
    submitResult,
    handleChange,
    handleBlur,
    handleSubmit,
    imageUpload,
  };
}
