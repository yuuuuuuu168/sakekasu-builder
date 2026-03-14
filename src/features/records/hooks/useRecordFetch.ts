import { useState, useEffect, useCallback } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../../../amplify/data/resource';
import type { UnifiedRecord } from '../types';

const client = generateClient<Schema>();

export interface UseRecordFetchReturn {
  records: UnifiedRecord[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function toPurchaseUnifiedRecord(
  record: Schema['PurchaseRecord']['type']
): UnifiedRecord {
  return {
    id: record.id,
    type: 'purchase',
    sakeName: record.sakeName,
    price: record.price,
    date: record.purchaseDate,
    category: record.category,
    memo: record.memo ?? undefined,
    storeName: record.storeName,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function toDrinkingUnifiedRecord(
  record: Schema['DrinkingRecord']['type']
): UnifiedRecord {
  return {
    id: record.id,
    type: 'drinking',
    sakeName: record.sakeName,
    price: record.price ?? null,
    date: record.drinkingDate,
    category: record.category,
    memo: record.memo ?? undefined,
    placeName: record.placeName,
    drinkingMethod: record.drinkingMethod,
    rating: record.rating,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function useRecordFetch(): UseRecordFetchReturn {
  const [records, setRecords] = useState<UnifiedRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecords = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const results = await Promise.allSettled([
      client.models.PurchaseRecord.list({}),
      client.models.DrinkingRecord.list({}),
    ]);

    const allRecords: UnifiedRecord[] = [];
    const errors: string[] = [];

    // PurchaseRecord の処理
    const purchaseResult = results[0];
    if (purchaseResult.status === 'fulfilled') {
      const { data, errors: apiErrors } = purchaseResult.value;
      if (apiErrors && apiErrors.length > 0) {
        console.error('PurchaseRecord list errors:', apiErrors);
        errors.push('購入記録の取得に失敗しました');
      } else {
        allRecords.push(...data.map(toPurchaseUnifiedRecord));
      }
    } else {
      console.error('PurchaseRecord list failed:', purchaseResult.reason);
      errors.push('購入記録の取得に失敗しました');
    }

    // DrinkingRecord の処理
    const drinkingResult = results[1];
    if (drinkingResult.status === 'fulfilled') {
      const { data, errors: apiErrors } = drinkingResult.value;
      if (apiErrors && apiErrors.length > 0) {
        console.error('DrinkingRecord list errors:', apiErrors);
        errors.push('飲酒記録の取得に失敗しました');
      } else {
        allRecords.push(...data.map(toDrinkingUnifiedRecord));
      }
    } else {
      console.error('DrinkingRecord list failed:', drinkingResult.reason);
      errors.push('飲酒記録の取得に失敗しました');
    }

    setRecords(allRecords);
    setError(errors.length > 0 ? errors.join('。') : null);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  return { records, isLoading, error, refetch: fetchRecords };
}
