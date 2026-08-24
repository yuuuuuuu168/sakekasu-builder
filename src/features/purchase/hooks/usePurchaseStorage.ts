import { useState } from 'react';
import { generateClient } from 'aws-amplify/api';
import { createPurchaseRecord, updatePurchaseRecord } from '@/graphql/mutations';
import type { PurchaseFormData, SaveResult } from '@/features/purchase/types';
import type { SakeSpecFormData } from '@/features/specs/types';
import { specsToCreateInput, specsToUpdateInput } from '@/features/specs/lib/sakeSpecs';

const client = generateClient();

export interface SavePurchaseOptions {
  imageKey?: string | null;
  imageKeys?: string[];
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
  const [isSaving, setIsSaving] = useState(false);

  const savePurchase = async (data: PurchaseFormData, options?: SavePurchaseOptions): Promise<SaveResult> => {
    setIsSaving(true);
    try {
      const result = await client.graphql({
        query: createPurchaseRecord,
        variables: {
          input: {
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
            imageKey: options?.imageKey ?? null,
            imageKeys: options?.imageKeys?.length ? options.imageKeys : undefined,
            drinkingStatus: 'NOT_STARTED',
          },
        },
      });

      if ('errors' in result && result.errors && result.errors.length > 0) {
        console.error('PurchaseRecord create errors:', result.errors);
        return { success: false, error: '登録に失敗しました。もう一度お試しください' };
      }

      return { success: true };
    } catch (error) {
      console.error('PurchaseRecord create failed:', error);
      return { success: false, error: '登録に失敗しました。もう一度お試しください' };
    } finally {
      setIsSaving(false);
    }
  };

  const updatePurchase = async (
    id: string,
    data: PurchaseFormData,
    options?: SavePurchaseOptions,
  ): Promise<SaveResult> => {
    setIsSaving(true);
    try {
      const result = await client.graphql({
        query: updatePurchaseRecord,
        variables: {
          input: {
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
        console.error('PurchaseRecord update errors:', result.errors);
        return { success: false, error: '更新に失敗しました。もう一度お試しください' };
      }

      return { success: true };
    } catch (error) {
      console.error('PurchaseRecord update failed:', error);
      return { success: false, error: '更新に失敗しました。もう一度お試しください' };
    } finally {
      setIsSaving(false);
    }
  };

  return { savePurchase, updatePurchase, isSaving };
}
