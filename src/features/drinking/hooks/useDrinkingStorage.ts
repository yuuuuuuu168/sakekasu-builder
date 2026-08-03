import { useState } from 'react';
import { generateClient } from 'aws-amplify/api';
import { createDrinkingRecord, updateDrinkingRecord } from '@/graphql/mutations';
import type { DrinkingFormData } from '../types';
import type { SaveResult } from '../../purchase/types';

const client = generateClient();

export interface SaveDrinkingOptions {
  imageKey?: string | null;
  imageKeys?: string[];
}

export interface UseDrinkingStorageReturn {
  saveDrinking: (data: DrinkingFormData, options?: SaveDrinkingOptions) => Promise<SaveResult>;
  /** 既存の飲酒記録を更新する（画像は対象外・既存を維持） */
  updateDrinking: (id: string, data: DrinkingFormData) => Promise<SaveResult>;
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
            imageKey: options?.imageKey ?? null,
            imageKeys: options?.imageKeys?.length ? options.imageKeys : undefined,
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

  const updateDrinking = async (id: string, data: DrinkingFormData): Promise<SaveResult> => {
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
