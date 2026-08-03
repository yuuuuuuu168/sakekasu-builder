import { useState, useEffect, useCallback } from 'react';
import { generateClient } from 'aws-amplify/api';
import { listPurchaseRecords, listDrinkingRecords } from '@/graphql/queries';
import type { PurchaseRecordType, DrinkingRecordType } from '@/types/schema';
import type { UnifiedRecord } from '../types';

const client = generateClient();

/** imageKey(単一) と imageKeys(複数) を統合して配列に正規化 */
function normalizeImageKeys(imageKey: string | null, imageKeys: string[] | null): string[] {
  if (imageKeys && imageKeys.length > 0) return imageKeys;
  if (imageKey) return [imageKey];
  return [];
}

export interface UseRecordFetchReturn {
  records: UnifiedRecord[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function toPurchaseUnifiedRecord(
  record: PurchaseRecordType,
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
    quantity: record.quantity ?? 1,
    drinkingStatus: record.drinkingStatus ?? 'NOT_STARTED',
    openedAt: record.openedAt ?? null,
    imageKey: record.imageKey,
    imageKeys: normalizeImageKeys(record.imageKey, record.imageKeys),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function toDrinkingUnifiedRecord(
  record: DrinkingRecordType,
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
    imageKey: record.imageKey,
    imageKeys: normalizeImageKeys(record.imageKey, record.imageKeys),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}


interface ListPurchaseRecordsResponse {
  listPurchaseRecords: PurchaseRecordType[];
}

interface ListDrinkingRecordsResponse {
  listDrinkingRecords: DrinkingRecordType[];
}

export function useRecordFetch(): UseRecordFetchReturn {
  const [records, setRecords] = useState<UnifiedRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecords = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const results = await Promise.allSettled([
      client.graphql({ query: listPurchaseRecords }),
      client.graphql({ query: listDrinkingRecords }),
    ]);

    const allRecords: UnifiedRecord[] = [];
    const errors: string[] = [];

    // PurchaseRecord の処理
    const purchaseResult = results[0];
    if (purchaseResult.status === 'fulfilled') {
      const response = purchaseResult.value as { data: ListPurchaseRecordsResponse };
      if (response.data?.listPurchaseRecords) {
        allRecords.push(
          ...response.data.listPurchaseRecords.map(toPurchaseUnifiedRecord),
        );
      }
    } else {
      console.error('PurchaseRecord list failed:', purchaseResult.reason);
      errors.push('購入記録の取得に失敗しました');
    }

    // DrinkingRecord の処理
    const drinkingResult = results[1];
    if (drinkingResult.status === 'fulfilled') {
      const response = drinkingResult.value as { data: ListDrinkingRecordsResponse };
      if (response.data?.listDrinkingRecords) {
        allRecords.push(
          ...response.data.listDrinkingRecords.map(toDrinkingUnifiedRecord),
        );
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
