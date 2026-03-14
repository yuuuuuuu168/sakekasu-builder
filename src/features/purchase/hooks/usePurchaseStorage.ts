import { useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../../amplify/data/resource';
import type { PurchaseFormData, SaveResult } from '@/features/purchase/types';

const client = generateClient<Schema>();

export interface UsePurchaseStorageReturn {
  savePurchase: (data: PurchaseFormData) => Promise<SaveResult>;
  isSaving: boolean;
}

export function usePurchaseStorage(): UsePurchaseStorageReturn {
  const [isSaving, setIsSaving] = useState(false);

  const savePurchase = async (data: PurchaseFormData): Promise<SaveResult> => {
    setIsSaving(true);
    try {
      const { errors } = await client.models.PurchaseRecord.create({
        sakeName: data.sakeName,
        storeName: data.storeName,
        price: parseInt(data.price, 10),
        purchaseDate: data.purchaseDate,
        category: data.category,
        memo: data.memo || undefined,
      });

      if (errors && errors.length > 0) {
        console.error('PurchaseRecord create errors:', errors);
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

  return { savePurchase, isSaving };
}
