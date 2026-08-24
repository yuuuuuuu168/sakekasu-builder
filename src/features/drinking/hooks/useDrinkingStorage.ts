import { useState } from 'react';
import { generateClient } from 'aws-amplify/api';
import { createDrinkingRecord, updateDrinkingRecord } from '@/graphql/mutations';
import type { DrinkingFormData } from '../types';
import type { SaveResult } from '../../purchase/types';
import type { SakeSpecFormData } from '@/features/specs/types';
import { specsToCreateInput, specsToUpdateInput } from '@/features/specs/lib/sakeSpecs';

const client = generateClient();

export interface SaveDrinkingOptions {
  imageKey?: string | null;
  imageKeys?: string[];
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
  const [isSaving, setIsSaving] = useState(false);

  const saveDrinking = async (data: DrinkingFormData, options?: SaveDrinkingOptions): Promise<SaveResult> => {
    setIsSaving(true);
    try {
      const result = await client.graphql({
        query: createDrinkingRecord,
        variables: {
          input: {
            sakeName: data.sakeName,
            placeName: data.placeName,
            price: data.price !== '' ? parseInt(data.price, 10) : undefined,
            drinkingDate: data.drinkingDate,
            category: data.category,
            drinkingMethod: data.drinkingMethod,
            rating: data.rating,
            memo: data.memo || undefined,
            ...(options?.specs ? specsToCreateInput(options.specs) : {}),
            imageKey: options?.imageKey ?? null,
            imageKeys: options?.imageKeys?.length ? options.imageKeys : undefined,
            purchaseRecordId: options?.purchaseRecordId ?? undefined,
          },
        },
      });

      if ('errors' in result && result.errors && result.errors.length > 0) {
        console.error('DrinkingRecord create errors:', result.errors);
        return { success: false, error: '登録に失敗しました。もう一度お試しください' };
      }

      return { success: true };
    } catch (error) {
      console.error('DrinkingRecord create failed:', error);
      return { success: false, error: '登録に失敗しました。もう一度お試しください' };
    } finally {
      setIsSaving(false);
    }
  };

  const updateDrinking = async (
    id: string,
    data: DrinkingFormData,
    options?: SaveDrinkingOptions,
  ): Promise<SaveResult> => {
    setIsSaving(true);
    try {
      const result = await client.graphql({
        query: updateDrinkingRecord,
        variables: {
          input: {
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
            // 画像を触らない更新では送らない。undefined を送ると
            // 既存のキーを消してしまう（更新式は渡されたフィールドだけを SET する）
            // 空配列は送らない。サーバー側で弾かれるうえ、意味としても
            // 「画像を触らない更新」と区別が付かない（create 側と揃える）
            ...(options?.imageKeys?.length
              ? { imageKey: options.imageKey ?? null, imageKeys: options.imageKeys }
              : {}),
          },
        },
      });

      if ('errors' in result && result.errors && result.errors.length > 0) {
        console.error('DrinkingRecord update errors:', result.errors);
        return { success: false, error: '更新に失敗しました。もう一度お試しください' };
      }

      return { success: true };
    } catch (error) {
      console.error('DrinkingRecord update failed:', error);
      return { success: false, error: '更新に失敗しました。もう一度お試しください' };
    } finally {
      setIsSaving(false);
    }
  };

  return { saveDrinking, updateDrinking, isSaving };
}
