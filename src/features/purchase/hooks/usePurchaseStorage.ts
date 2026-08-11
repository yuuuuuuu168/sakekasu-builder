import { useState } from 'react';
import { generateClient } from 'aws-amplify/api';
import { createPurchaseRecord, updatePurchaseRecord } from '@/graphql/mutations';
import type { PurchaseFormData, SaveResult } from '@/features/purchase/types';

const client = generateClient();

export interface SavePurchaseOptions {
  imageKey?: string | null;
  imageKeys?: string[];
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
            purchaseDate: data.purchaseDate,
            category: data.category,
            memo: data.memo || undefined,
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
            // 画像を触らない更新では送らない。undefined を送ると
            // 既存のキーを消してしまう（更新式は渡されたフィールドだけを SET する）
            ...(options?.imageKeys
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
