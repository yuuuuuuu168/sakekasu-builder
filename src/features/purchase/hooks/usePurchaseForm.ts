import { useState, useCallback } from 'react';
import type { PurchaseFormData, SaveResult } from '@/features/purchase/types';
import { useFormValidation } from '@/features/purchase/hooks/useFormValidation';
import { usePurchaseStorage } from '@/features/purchase/hooks/usePurchaseStorage';
import { useImageUpload } from '@/features/image/hooks/useImageUpload';
import type { UseFormValidationReturn } from '@/features/purchase/hooks/useFormValidation';
import type { UsePurchaseStorageReturn } from '@/features/purchase/hooks/usePurchaseStorage';
import type { UseImageUploadReturn } from '@/features/image/hooks/useImageUpload';
import { getTodayString } from '@/lib/dateUtils';

export interface UsePurchaseFormOptions {
  /** 編集対象の記録ID。指定時は「編集モード」となり、更新mutationを呼ぶ */
  recordId?: string;
  /** フォームの初期値（編集モードでのプリフィル用） */
  initialData?: PurchaseFormData;
}

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

export function getInitialFormData(): PurchaseFormData {
  return {
    sakeName: '',
    storeName: '',
    price: '',
    quantity: '1',
    purchaseDate: getTodayString(),
    category: 'NIHONSHU',
    memo: '',
  };
}

export function usePurchaseForm(options?: UsePurchaseFormOptions): UsePurchaseFormReturn {
  const { recordId, initialData } = options ?? {};
  const isEditMode = recordId !== undefined;

  const [formData, setFormData] = useState<PurchaseFormData>(
    () => initialData ?? getInitialFormData(),
  );
  const [submitResult, setSubmitResult] = useState<SaveResult | null>(null);

  const { errors, validateField, isValid, clearErrors } = useFormValidation();
  const { savePurchase, updatePurchase, isSaving } = usePurchaseStorage();
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

    // 編集モード: 画像は対象外。テキスト・メタ情報のみ更新し、フォームはリセットしない
    if (isEditMode) {
      const result = await updatePurchase(recordId, formData);
      setSubmitResult(result);
      return;
    }

    // 画像がある場合はアップロードを先に実行
    let imageKey: string | null = null;
    let imageKeys: string[] = [];
    if (imageUpload.imageFiles.length > 0) {
      const newRecordId = crypto.randomUUID();
      imageKeys = await imageUpload.uploadImages('purchase', newRecordId);
      if (imageKeys.length === 0 && imageUpload.imageFiles.length > 0) {
        // アップロード失敗 → エラーは useImageUpload 側で設定済み、入力内容を保持
        return;
      }
      imageKey = imageKeys[0] ?? null;
    }

    const result = await savePurchase(formData, { imageKey, imageKeys });

    if (result.success) {
      setFormData(getInitialFormData());
      clearErrors();
      imageUpload.clearImage();
      setSubmitResult({ success: true });
    } else {
      setSubmitResult(result);
    }
  }, [formData, isValid, isEditMode, recordId, savePurchase, updatePurchase, clearErrors, imageUpload]);

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
