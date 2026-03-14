import { useState, useCallback } from 'react';
import type { DrinkingFormData, DrinkingValidationErrors } from '../types';
import { categoryRequiresDrinkingMethod } from '../types';
import type { SakeCategory } from '../../purchase/types';
import { useDrinkingValidation } from './useDrinkingValidation';
import { useDrinkingStorage } from './useDrinkingStorage';
import { useImageUpload } from '@/features/image/hooks/useImageUpload';
import type { UseImageUploadReturn } from '@/features/image/hooks/useImageUpload';

export interface UseDrinkingFormReturn {
  formData: DrinkingFormData;
  errors: DrinkingValidationErrors;
  isSaving: boolean;
  isFormValid: boolean;
  handleChange: (field: keyof DrinkingFormData, value: string | number) => void;
  handleBlur: (field: keyof DrinkingFormData) => void;
  handleSubmit: () => Promise<void>;
  successMessage: string | null;
  errorMessage: string | null;
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

export function getInitialDrinkingFormData(placeName: string = ''): DrinkingFormData {
  return {
    sakeName: '',
    placeName,
    price: '',
    drinkingDate: getTodayString(),
    category: 'NIHONSHU',
    drinkingMethod: '',
    rating: 0,
    memo: '',
  };
}

export function useDrinkingForm(): UseDrinkingFormReturn {
  const [formData, setFormData] = useState<DrinkingFormData>(getInitialDrinkingFormData);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { errors, validateField, isValid, clearErrors } = useDrinkingValidation();
  const { saveDrinking, isSaving } = useDrinkingStorage();
  const imageUpload = useImageUpload();

  const isFormValid = Object.keys(errors).length === 0;

  const handleChange = useCallback(
    (field: keyof DrinkingFormData, value: string | number) => {
      setFormData((prev) => {
        const next = { ...prev, [field]: value };
        // カテゴリ変更時に飲み方をリセット
        if (field === 'category') {
          const cat = value as string;
          next.drinkingMethod = categoryRequiresDrinkingMethod(cat as SakeCategory)
            ? ''
            : '-';
        }
        return next;
      });
    },
    [],
  );

  const handleBlur = useCallback(
    (field: keyof DrinkingFormData) => {
      validateField(field, formData[field]);
    },
    [validateField, formData],
  );

  const handleSubmit = useCallback(async () => {
    setSuccessMessage(null);
    setErrorMessage(null);

    if (!isValid(formData)) {
      return;
    }

    // 画像がある場合はアップロードを先に実行
    let imageKey: string | null = null;
    if (imageUpload.imageFile) {
      const recordId = crypto.randomUUID();
      const key = await imageUpload.uploadImage('drinking', recordId);
      if (key === null) {
        // アップロード失敗 → エラーは useImageUpload 側で設定済み、入力内容を保持
        return;
      }
      imageKey = key;
    }

    const result = await saveDrinking(formData, { imageKey });

    if (result.success) {
      // 飲んだ場所を保持してリセット
      setFormData(getInitialDrinkingFormData(formData.placeName));
      clearErrors();
      imageUpload.clearImage();
      setSuccessMessage('登録が完了しました');
    } else {
      setErrorMessage(result.error || '登録に失敗しました。もう一度お試しください');
    }
  }, [formData, isValid, saveDrinking, clearErrors, imageUpload]);

  return {
    formData,
    errors,
    isSaving,
    isFormValid,
    handleChange,
    handleBlur,
    handleSubmit,
    successMessage,
    errorMessage,
    imageUpload,
  };
}
