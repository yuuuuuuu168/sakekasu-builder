import { createPurchaseRecord, updatePurchaseRecord } from '@/graphql/mutations';
import type { PurchaseFormData } from '@/features/purchase/types';
import type { SaveResult } from '@/types/sake';
import type { SakeSpecFormData } from '@/features/specs/types';
import { specsToCreateInput, specsToUpdateInput } from '@/features/specs/lib/sakeSpecs';
import {
  CREATE_FAILED_MESSAGE,
  UPDATE_FAILED_MESSAGE,
  imageFieldsForCreate,
  imageFieldsForUpdate,
  useRecordMutation,
} from '@/lib/recordMutation';
import type { RecordImageOptions } from '@/lib/recordMutation';

export interface SavePurchaseOptions extends RecordImageOptions {
  /**
   * 更新後の残本数（まだ飲みきっていない本数）。
   * 本数を編集したときだけ渡す。渡さなければサーバ側の値をそのまま残す
   */
  remainingQuantity?: number;
  /**
   * 詳細スペックの入力値（Issue #87）。
   *
   * 作成では値のある項目だけを載せ、更新では空欄を null として送る。
   * 更新で省いてしまうと、入力欄を空にしても以前の値が残る
   */
  specs?: SakeSpecFormData;
}

export interface UsePurchaseStorageReturn {
  savePurchase: (data: PurchaseFormData, options?: SavePurchaseOptions) => Promise<SaveResult>;
  /**
   * 既存の購入記録を更新する。
   *
   * options に imageKeys を渡したときだけ画像を書き換える。渡さなければ
   * 既存のキーはそのまま残る（Issue #142 で追加できるようにした）
   */
  updatePurchase: (
    id: string,
    data: PurchaseFormData,
    options?: SavePurchaseOptions,
  ) => Promise<SaveResult>;
  isSaving: boolean;
}

export function usePurchaseStorage(): UsePurchaseStorageReturn {
  const { run, isSaving } = useRecordMutation();

  const savePurchase = (data: PurchaseFormData, options?: SavePurchaseOptions): Promise<SaveResult> =>
    run(
      createPurchaseRecord,
      {
        sakeName: data.sakeName,
        storeName: data.storeName,
        price: parseInt(data.price, 10),
        quantity: parseInt(data.quantity, 10),
        // 登録した時点では1本も飲んでいない
        remainingQuantity: parseInt(data.quantity, 10),
        purchaseDate: data.purchaseDate,
        category: data.category,
        memo: data.memo || undefined,
        ...(options?.specs ? specsToCreateInput(options.specs) : {}),
        ...imageFieldsForCreate(options),
        drinkingStatus: 'NOT_STARTED',
      },
      { logLabel: 'PurchaseRecord create', failureMessage: CREATE_FAILED_MESSAGE },
    );

  const updatePurchase = (
    id: string,
    data: PurchaseFormData,
    options?: SavePurchaseOptions,
  ): Promise<SaveResult> =>
    run(
      updatePurchaseRecord,
      {
        id,
        sakeName: data.sakeName,
        storeName: data.storeName,
        price: parseInt(data.price, 10),
        quantity: parseInt(data.quantity, 10),
        purchaseDate: data.purchaseDate,
        category: data.category,
        memo: data.memo || null,
        ...(options?.specs ? specsToUpdateInput(options.specs) : {}),
        // 本数を変えたときだけ残本数も合わせる（飲んだ本数は保ったまま）
        ...(options?.remainingQuantity !== undefined && {
          remainingQuantity: options.remainingQuantity,
        }),
        ...imageFieldsForUpdate(options),
      },
      { logLabel: 'PurchaseRecord update', failureMessage: UPDATE_FAILED_MESSAGE },
    );

  return { savePurchase, updatePurchase, isSaving };
}
