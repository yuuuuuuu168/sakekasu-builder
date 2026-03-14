import { useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../../amplify/data/resource';
import type { DrinkingFormData } from '../types';
import type { SaveResult } from '../../purchase/types';

const client = generateClient<Schema>();

export interface UseDrinkingStorageReturn {
  saveDrinking: (data: DrinkingFormData) => Promise<SaveResult>;
  isSaving: boolean;
}

export function useDrinkingStorage(): UseDrinkingStorageReturn {
  const [isSaving, setIsSaving] = useState(false);

  const saveDrinking = async (data: DrinkingFormData): Promise<SaveResult> => {
    setIsSaving(true);
    try {
      const { errors } = await client.models.DrinkingRecord.create({
        sakeName: data.sakeName,
        placeName: data.placeName,
        price: data.price !== '' ? parseInt(data.price, 10) : undefined,
        drinkingDate: data.drinkingDate,
        category: data.category,
        drinkingMethod: data.drinkingMethod,
        rating: data.rating,
        memo: data.memo || undefined,
      });

      if (errors && errors.length > 0) {
        console.error('DrinkingRecord create errors:', errors);
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

  return { saveDrinking, isSaving };
}
