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
  /** 編集対象が既に持っている代表画像キー */
  existingImageKey?: string | null;
  /** 編集対象が既に持っている画像キー一覧。追加分はこの後ろに足す */
  existingImageKeys?: string[];
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
  const {
    recordId,
    initialData,
    existingImageKey = null,
    existingImageKeys,
  } = options ?? {};
  const isEditMode = recordId !== undefined;

  // 記録に添付できる枚数は全体で決まっているので、追加できるのは残り枠だけ
  const alreadyAttached = existingImageKeys?.length ?? 0;

  const [formData, setFormData] = useState<PurchaseFormData>(
    () => initialData ?? getInitialFormData(),
  );
  const [submitResult, setSubmitResult] = useState<SaveResult | null>(null);

  const { errors, validateField, isValid, clearErrors } = useFormValidation();
  const { savePurchase, updatePurchase, isSaving } = usePurchaseStorage();
  const imageUpload = useImageUpload({ alreadyAttached });

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

    // 編集モード: 画像を足していれば既存の後ろに追記する。フォームはリセットしない
    if (isEditMode) {
      if (imageUpload.imageFiles.length === 0) {
        // 画像に触っていない更新では画像の項目自体を送らない（既存キーを維持する）
        const result = await updatePurchase(recordId, formData);
        setSubmitResult(result);
        return;
      }

      const uploaded = await imageUpload.uploadImages('purchase', recordId);
      if (uploaded.length === 0) {
        // アップロード失敗 → エラーは useImageUpload 側で設定済み、入力内容を保持
        return;
      }

      const base = existingImageKeys ?? [];
      const merged = [...base, ...uploaded];
      const result = await updatePurchase(recordId, formData, {
        // 代表画像は既存を優先する。差し替えではなく追加なので、
        // 一覧のサムネイルが勝手に入れ替わらないようにする
        imageKey: existingImageKey ?? uploaded[0] ?? null,
        imageKeys: merged,
      });

      if (result.success) {
        // 追記済みのファイルを残すと、次の保存で二重に足される
        imageUpload.clearImage();
      }
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
  }, [
    formData,
    isValid,
    isEditMode,
    recordId,
    savePurchase,
    updatePurchase,
    clearErrors,
    imageUpload,
    existingImageKey,
    existingImageKeys,
  ]);

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
