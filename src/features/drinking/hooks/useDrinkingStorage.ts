import { createDrinkingRecord, updateDrinkingRecord } from '@/graphql/mutations';
import type { DrinkingFormData } from '../types';
import type { SaveResult } from '../../purchase/types';
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

export interface SaveDrinkingOptions extends RecordImageOptions {
  /** 在庫（購入記録）から登録する場合の紐づけ先 */
  purchaseRecordId?: string | null;
  /**
   * 詳細スペックの入力値（Issue #87）。
   *
   * 作成では値のある項目だけを載せ、更新では空欄を null として送る。
   * 更新で省いてしまうと、入力欄を空にしても以前の値が残る
   */
  specs?: SakeSpecFormData;
}

export interface UseDrinkingStorageReturn {
  saveDrinking: (data: DrinkingFormData, options?: SaveDrinkingOptions) => Promise<SaveResult>;
  /**
   * 既存の飲酒記録を更新する。
   *
   * options に imageKeys を渡したときだけ画像を書き換える。渡さなければ
   * 既存のキーはそのまま残る（Issue #142 で追加できるようにした）
   */
  updateDrinking: (
    id: string,
    data: DrinkingFormData,
    options?: SaveDrinkingOptions,
  ) => Promise<SaveResult>;
  isSaving: boolean;
}

export function useDrinkingStorage(): UseDrinkingStorageReturn {
  const { run, isSaving } = useRecordMutation();

  const saveDrinking = (data: DrinkingFormData, options?: SaveDrinkingOptions): Promise<SaveResult> =>
    run(
      createDrinkingRecord,
      {
        sakeName: data.sakeName,
        placeName: data.placeName,
        price: data.price !== '' ? parseInt(data.price, 10) : undefined,
        drinkingDate: data.drinkingDate,
        category: data.category,
        drinkingMethod: data.drinkingMethod,
        rating: data.rating,
        memo: data.memo || undefined,
        ...(options?.specs ? specsToCreateInput(options.specs) : {}),
        ...imageFieldsForCreate(options),
        purchaseRecordId: options?.purchaseRecordId ?? undefined,
      },
      { logLabel: 'DrinkingRecord create', failureMessage: CREATE_FAILED_MESSAGE },
    );

  const updateDrinking = (
    id: string,
    data: DrinkingFormData,
    options?: SaveDrinkingOptions,
  ): Promise<SaveResult> =>
    run(
      updateDrinkingRecord,
      {
        id,
        sakeName: data.sakeName,
        placeName: data.placeName,
        price: data.price !== '' ? parseInt(data.price, 10) : null,
        drinkingDate: data.drinkingDate,
        category: data.category,
        drinkingMethod: data.drinkingMethod,
        rating: data.rating,
        memo: data.memo || null,
        ...(options?.specs ? specsToUpdateInput(options.specs) : {}),
        ...imageFieldsForUpdate(options),
      },
      { logLabel: 'DrinkingRecord update', failureMessage: UPDATE_FAILED_MESSAGE },
    );

  return { saveDrinking, updateDrinking, isSaving };
}
