import { useState, useCallback } from 'react';
import type { DrinkingFormData, DrinkingValidationErrors, StockDrinkDraft } from '../types';
import { categoryRequiresDrinkingMethod, STOCK_DRINK_PLACE_NAME } from '../types';
import type { SakeCategory } from '../../purchase/types';
import { markPurchaseAsInProgress } from '@/features/purchase/lib/purchaseStatus';
import { useDrinkingValidation } from './useDrinkingValidation';
import { useDrinkingStorage } from './useDrinkingStorage';
import { useImageUpload } from '@/features/image/hooks/useImageUpload';
import type { UseImageUploadReturn } from '@/features/image/hooks/useImageUpload';
import { getTodayString } from '@/lib/dateUtils';

export interface UseDrinkingFormOptions {
  /** 編集対象の記録ID。指定時は「編集モード」となり、更新mutationを呼ぶ */
  recordId?: string;
  /** フォームの初期値（編集モードでのプリフィル用） */
  initialData?: DrinkingFormData;
  /** 在庫（購入記録）から登録する場合の紐づけ情報 */
  stockDraft?: StockDrinkDraft | null;
  /** 在庫からの登録が完了したときの通知（紐づけ解除に使う） */
  onStockDrinkSaved?: () => void;
}

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

/**
 * 在庫（購入記録）から飲む場合のフォーム初期値。
 * 銘柄名とカテゴリを引き継ぎ、飲んだ場所は自宅を既定にする。
 */
export function getStockDrinkFormData(draft: StockDrinkDraft): DrinkingFormData {
  return {
    ...getInitialDrinkingFormData(STOCK_DRINK_PLACE_NAME),
    sakeName: draft.sakeName,
    category: draft.category,
    drinkingMethod: categoryRequiresDrinkingMethod(draft.category) ? '' : '-',
  };
}

export function useDrinkingForm(options?: UseDrinkingFormOptions): UseDrinkingFormReturn {
  const { recordId, initialData, stockDraft, onStockDrinkSaved } = options ?? {};
  const isEditMode = recordId !== undefined;

  const [formData, setFormData] = useState<DrinkingFormData>(
    () => initialData ?? (stockDraft ? getStockDrinkFormData(stockDraft) : getInitialDrinkingFormData()),
  );
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { errors, validateField, isValid, clearErrors } = useDrinkingValidation();
  const { saveDrinking, updateDrinking, isSaving } = useDrinkingStorage();
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

    // 編集モード: 画像は対象外。テキスト・メタ情報のみ更新し、フォームはリセットしない
    if (isEditMode) {
      const result = await updateDrinking(recordId, formData);
      if (result.success) {
        setSuccessMessage('更新が完了しました');
      } else {
        setErrorMessage(result.error || '更新に失敗しました。もう一度お試しください');
      }
      return;
    }

    // 画像がある場合はアップロードを先に実行
    let imageKey: string | null = null;
    let imageKeys: string[] = [];
    if (imageUpload.imageFiles.length > 0) {
      const newRecordId = crypto.randomUUID();
      imageKeys = await imageUpload.uploadImages('drinking', newRecordId);
      if (imageKeys.length === 0 && imageUpload.imageFiles.length > 0) {
        // アップロード失敗 → エラーは useImageUpload 側で設定済み、入力内容を保持
        return;
      }
      imageKey = imageKeys[0] ?? null;
    }

    const result = await saveDrinking(formData, {
      imageKey,
      imageKeys,
      purchaseRecordId: stockDraft?.purchaseRecordId ?? null,
    });

    if (!result.success) {
      setErrorMessage(result.error || '登録に失敗しました。もう一度お試しください');
      return;
    }

    // 在庫から登録した場合、未開封なら「飲み中」へ自動更新する。
    // ここで失敗しても飲酒記録自体は登録済みなのでメッセージだけ変える
    let message = '登録が完了しました';
    if (stockDraft) {
      if (stockDraft.drinkingStatus === 'NOT_STARTED') {
        const opened = await markPurchaseAsInProgress(stockDraft.purchaseRecordId);
        message = opened
          ? '登録が完了しました。在庫を「飲み中」に更新しました'
          : '登録は完了しましたが、在庫のステータス更新に失敗しました';
      }
      onStockDrinkSaved?.();
    }

    // 飲んだ場所を保持してリセット
    setFormData(getInitialDrinkingFormData(formData.placeName));
    clearErrors();
    imageUpload.clearImage();
    setSuccessMessage(message);
  }, [formData, isValid, isEditMode, recordId, saveDrinking, updateDrinking, clearErrors, imageUpload, stockDraft, onStockDrinkSaved]);

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
