import { useState, useCallback, useRef } from 'react';
import type { DrinkingFormData, DrinkingValidationErrors, StockDrinkDraft } from '../types';
import { categoryRequiresDrinkingMethod, STOCK_DRINK_PLACE_NAME } from '../types';
import type { SakeCategory } from '../../purchase/types';
import { markPurchaseAsInProgress } from '@/features/purchase/lib/purchaseStatus';
import { useDrinkingValidation } from './useDrinkingValidation';
import { useDrinkingStorage } from './useDrinkingStorage';
import { useImageUpload } from '@/features/image/hooks/useImageUpload';
import type { UseImageUploadReturn } from '@/features/image/hooks/useImageUpload';
import { copyRecordImages } from '@/features/image/lib/copyRecordImages';
import { useSakeSpecs } from '@/features/specs/hooks/useSakeSpecs';
import type { UseSakeSpecsReturn } from '@/features/specs/hooks/useSakeSpecs';
import type { SakeSpecFormData } from '@/features/specs/types';
import { specsToFormData } from '@/features/specs/lib/sakeSpecs';
import { getTodayString } from '@/lib/dateUtils';

export interface UseDrinkingFormOptions {
  /** 編集対象の記録ID。指定時は「編集モード」となり、更新mutationを呼ぶ */
  recordId?: string;
  /** フォームの初期値（編集モードでのプリフィル用） */
  initialData?: DrinkingFormData;
  /** 詳細スペックの初期値（編集モードでのプリフィル用。Issue #87） */
  initialSpecs?: SakeSpecFormData;
  /** 在庫（購入記録）から登録する場合の紐づけ情報 */
  stockDraft?: StockDrinkDraft | null;
  /** 在庫からの登録が完了したときの通知（紐づけ解除に使う） */
  onStockDrinkSaved?: () => void;
  /** 編集対象が既に持っている代表画像キー */
  existingImageKey?: string | null;
  /** 編集対象が既に持っている画像キー一覧。追加分はこの後ろに足す */
  existingImageKeys?: string[];
}

export interface UseDrinkingFormReturn {
  formData: DrinkingFormData;
  errors: DrinkingValidationErrors;
  isSaving: boolean;
  /**
   * 送信開始からフォームのリセット完了までを覆うフラグ。
   * isSaving は保存 mutation の間しか true にならないため、その後の
   * 在庫ステータス更新の間にボタンが復活して二重送信できてしまう
   */
  isSubmitting: boolean;
  isFormValid: boolean;
  handleChange: (field: keyof DrinkingFormData, value: string | number) => void;
  handleBlur: (field: keyof DrinkingFormData) => void;
  handleSubmit: () => Promise<void>;
  successMessage: string | null;
  errorMessage: string | null;
  /** 画像アップロード関連 */
  imageUpload: UseImageUploadReturn;
  /** 詳細スペック（任意項目）の入力状態 */
  specs: UseSakeSpecsReturn;
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
  const {
    recordId,
    initialData,
    initialSpecs,
    stockDraft,
    onStockDrinkSaved,
    existingImageKey = null,
    existingImageKeys,
  } = options ?? {};
  const isEditMode = recordId !== undefined;

  // 記録に添付できる枚数は全体で決まっているので、追加できるのは残り枠だけ
  const alreadyAttached = existingImageKeys?.length ?? 0;

  const [formData, setFormData] = useState<DrinkingFormData>(
    () => initialData ?? (stockDraft ? getStockDrinkFormData(stockDraft) : getInitialDrinkingFormData()),
  );
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { errors, validateField, isValid, clearErrors } = useDrinkingValidation();
  const { saveDrinking, updateDrinking, isSaving } = useDrinkingStorage();
  const imageUpload = useImageUpload({ alreadyAttached });
  // 編集時の初期値が最優先。無ければ在庫（購入記録）から引き継いだスペックを使う
  const specs = useSakeSpecs(
    initialSpecs ?? (stockDraft?.specs ? specsToFormData(stockDraft.specs) : undefined),
  );

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

  // 送信中フラグ。state だけだと連打の 2 回目が再レンダー前に走るので ref も併用する
  const submittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);

    try {
      setSuccessMessage(null);
      setErrorMessage(null);

      // 詳細スペックの検証も通してから保存する。
      // isValid は必ず呼んでエラー表示を更新したいので、|| の短絡に頼らず両方評価する
      const isBaseValid = isValid(formData);
      const isSpecValid = specs.validateSpecs();
      if (!isBaseValid || !isSpecValid) {
        return;
      }

      // 編集モード: 画像を足していれば既存の後ろに追記する。フォームはリセットしない
      if (isEditMode) {
        let imageOptions: { imageKey: string | null; imageKeys: string[] } | undefined;

        if (imageUpload.imageFiles.length > 0) {
          const uploaded = await imageUpload.uploadImages('drinking', recordId);
          if (uploaded.length === 0) {
            // アップロード失敗 → エラーは useImageUpload 側で設定済み、入力内容を保持
            return;
          }
          imageOptions = {
            // 代表画像は既存を優先する。差し替えではなく追加なので、
            // 一覧のサムネイルが勝手に入れ替わらないようにする
            imageKey: existingImageKey ?? uploaded[0] ?? null,
            imageKeys: [...(existingImageKeys ?? []), ...uploaded],
          };
        }

        const result = await updateDrinking(recordId, formData, {
          ...imageOptions,
          specs: specs.specs,
        });
        if (result.success) {
          // 追記済みのファイルを残すと、次の保存で二重に足される
          if (imageOptions) imageUpload.clearImage();
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
      } else if (stockDraft?.imageKeys?.length) {
        // 写真を撮り直していない在庫からの登録では、購入記録の写真を引き継ぐ。
        // キーを共有すると片方の削除で実体が消えるため、実体ごと複製する。
        //
        // ここで失敗しても記録は残したいので、画像なしで登録を続ける
        try {
          imageKeys = await copyRecordImages(
            stockDraft.imageKeys,
            'drinking',
            crypto.randomUUID(),
          );
          imageKey = imageKeys[0] ?? null;
        } catch (err) {
          console.error('在庫の画像を引き継げませんでした:', err);
        }
      }

      const result = await saveDrinking(formData, {
        imageKey,
        imageKeys,
        purchaseRecordId: stockDraft?.purchaseRecordId ?? null,
        specs: specs.specs,
      });

      if (!result.success) {
        setErrorMessage(result.error || '登録に失敗しました。もう一度お試しください');
        return;
      }

      // 在庫から登録した場合は開封を試みる。未開封かどうかの判定はサーバ側の条件式に
      // 任せているので、クライアントが持つステータスが古くても開封日時は壊れない。
      // ここで失敗しても飲酒記録自体は登録済みなのでメッセージだけ変える
      let message = '登録が完了しました';
      if (stockDraft) {
        const opened = await markPurchaseAsInProgress(stockDraft.purchaseRecordId);
        if (opened === 'opened') {
          message = '登録が完了しました。在庫を「飲み中」に更新しました';
        } else if (opened === 'failed') {
          message = '登録は完了しましたが、在庫のステータス更新に失敗しました';
        }
        onStockDrinkSaved?.();
      }

      // 飲んだ場所を保持してリセット
      setFormData(getInitialDrinkingFormData(formData.placeName));
      clearErrors();
      specs.resetSpecs();
      imageUpload.clearImage();
      setSuccessMessage(message);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [
    formData,
    isValid,
    isEditMode,
    recordId,
    saveDrinking,
    updateDrinking,
    clearErrors,
    imageUpload,
    stockDraft,
    onStockDrinkSaved,
    existingImageKey,
    existingImageKeys,
    specs,
  ]);

  return {
    formData,
    errors,
    isSaving,
    isSubmitting,
    isFormValid,
    handleChange,
    handleBlur,
    handleSubmit,
    successMessage,
    errorMessage,
    imageUpload,
    specs,
  };
}
