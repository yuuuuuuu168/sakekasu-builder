import { useState, useCallback } from 'react';
import type { PurchaseFormData, SaveResult } from '@/features/purchase/types';
import { useFormValidation } from '@/features/purchase/hooks/useFormValidation';
import { usePurchaseStorage } from '@/features/purchase/hooks/usePurchaseStorage';
import { useImageUpload } from '@/features/image/hooks/useImageUpload';
import { useTastingNote } from '@/features/tasting/hooks/useTastingNote';
import type { UseFormValidationReturn } from '@/features/purchase/hooks/useFormValidation';
import type { UsePurchaseStorageReturn } from '@/features/purchase/hooks/usePurchaseStorage';
import type { UseImageUploadReturn } from '@/features/image/hooks/useImageUpload';
import { getTodayString } from '@/lib/dateUtils';
import { remainingAfterQuantityChange, toBottleCount } from '@/features/records/lib/bottleCount';
import type { BottleStock } from '@/features/records/lib/bottleCount';

export interface UsePurchaseFormOptions {
  /** 編集対象の記録ID。指定時は「編集モード」となり、更新mutationを呼ぶ */
  recordId?: string;
  /** フォームの初期値（編集モードでのプリフィル用） */
  initialData?: PurchaseFormData;
  /** 編集対象が既に持っている代表画像キー */
  existingImageKey?: string | null;
  /** 編集対象が既に持っている画像キー一覧。追加分はこの後ろに足す */
  existingImageKeys?: string[];
  /**
   * 編集対象が持っている本数と残本数。
   * 本数を書き換えたときに、飲んだぶんを保ったまま残本数を合わせるのに使う（Issue #159）
   */
  existingBottles?: BottleStock;
}

export interface UsePurchaseFormReturn {
  formData: PurchaseFormData;
  errors: UseFormValidationReturn['errors'];
  isSaving: UsePurchaseStorageReturn['isSaving'];
  /** テイスティングノートの生成中フラグ（登録ボタンの表示に使う） */
  isGeneratingNote: boolean;
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
    existingBottles,
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
  const { fillMemo, isGenerating: isGeneratingNote } = useTastingNote();

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

    // ウイスキー・日本酒なら、保存する前に備考へテイスティングノートを足す。
    // 画像を選んだ時点ではなく登録ボタンを押した時点で動かすのは、銘柄名が
    // OCR の後に手で直されることがあるため。
    //
    // 生成に失敗しても memo は元のまま返るので、登録そのものは止まらない
    const memo = await fillMemo(formData.memo, formData.sakeName, formData.category);
    const dataToSave: PurchaseFormData = { ...formData, memo };
    // 画面にも反映する。編集モードでは保存後もフォームが残るため、
    // 足した行が見えないと「書かれたのかどうか」が分からない
    if (memo !== formData.memo) {
      setFormData((prev) => ({ ...prev, memo }));
    }

    // 本数を書き換えたときだけ残本数も直す。飲んだ本数は変わらないので、
    // 3本のうち1本飲んだ記録を5本に直したら残りは4本になる
    const nextQuantity = parseInt(dataToSave.quantity, 10);
    const remainingUpdate =
      existingBottles && nextQuantity !== toBottleCount(existingBottles.quantity)
        ? { remainingQuantity: remainingAfterQuantityChange(existingBottles, nextQuantity) }
        : undefined;

    // 編集モード: 画像を足していれば既存の後ろに追記する。フォームはリセットしない
    if (isEditMode) {
      if (imageUpload.imageFiles.length === 0) {
        // 画像に触っていない更新では画像の項目自体を送らない（既存キーを維持する）
        const result = await updatePurchase(recordId, dataToSave, remainingUpdate);
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
      const result = await updatePurchase(recordId, dataToSave, {
        // 代表画像は既存を優先する。差し替えではなく追加なので、
        // 一覧のサムネイルが勝手に入れ替わらないようにする
        imageKey: existingImageKey ?? uploaded[0] ?? null,
        imageKeys: merged,
        ...remainingUpdate,
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

    const result = await savePurchase(dataToSave, { imageKey, imageKeys });

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
    existingBottles,
    fillMemo,
  ]);

  return {
    formData,
    errors,
    isSaving,
    isGeneratingNote,
    submitResult,
    handleChange,
    handleBlur,
    handleSubmit,
    imageUpload,
  };
}
