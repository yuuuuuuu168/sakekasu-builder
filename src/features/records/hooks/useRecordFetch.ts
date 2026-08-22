import { useState, useEffect, useCallback } from 'react';
import { generateClient } from 'aws-amplify/api';
import { listPurchaseRecords, listDrinkingRecords } from '@/graphql/queries';
import type {
  PurchaseRecordType,
  DrinkingRecordType,
  PurchaseRecordConnection,
  DrinkingRecordConnection,
} from '@/types/schema';
import { fetchAllPages, PAGE_LIMIT } from '@/lib/pagination';
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
    // 残本数を持たない記録は quantity 側で補完する（bottleCount.ts が面倒をみる）
    remainingQuantity: record.remainingQuantity ?? undefined,
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
    purchaseRecordId: record.purchaseRecordId ?? null,
    imageKey: record.imageKey,
    imageKeys: normalizeImageKeys(record.imageKey, record.imageKeys),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}


interface ListPurchaseRecordsResponse {
  listPurchaseRecords: PurchaseRecordConnection;
}

interface ListDrinkingRecordsResponse {
  listDrinkingRecords: DrinkingRecordConnection;
}

/** 購入記録を nextToken がなくなるまで全ページ取得する */
async function fetchAllPurchaseRecords(): Promise<PurchaseRecordType[]> {
  return fetchAllPages(async (nextToken) => {
    const response = (await client.graphql({
      query: listPurchaseRecords,
      variables: { limit: PAGE_LIMIT, nextToken },
    })) as { data: ListPurchaseRecordsResponse };
    return response.data?.listPurchaseRecords;
  });
}

/** 飲酒記録を nextToken がなくなるまで全ページ取得する */
async function fetchAllDrinkingRecords(): Promise<DrinkingRecordType[]> {
  return fetchAllPages(async (nextToken) => {
    const response = (await client.graphql({
      query: listDrinkingRecords,
      variables: { limit: PAGE_LIMIT, nextToken },
    })) as { data: ListDrinkingRecordsResponse };
    return response.data?.listDrinkingRecords;
  });
}

export function useRecordFetch(): UseRecordFetchReturn {
  const [records, setRecords] = useState<UnifiedRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 取得のきっかけを effect ひとつに寄せる。refetch はこの値を進めるだけで、
  // 実際の取得と state 更新は effect の中だけで起きる。取得中に再取得や
  // アンマウントが起きたら、古い応答は cleanup 側の cancelled で捨てる
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);

      const results = await Promise.allSettled([
        fetchAllPurchaseRecords(),
        fetchAllDrinkingRecords(),
      ]);

      if (cancelled) return;

      const allRecords: UnifiedRecord[] = [];
      const errors: string[] = [];

      // PurchaseRecord の処理
      const purchaseResult = results[0];
      if (purchaseResult.status === 'fulfilled') {
        allRecords.push(...purchaseResult.value.map(toPurchaseUnifiedRecord));
      } else {
        console.error('PurchaseRecord list failed:', purchaseResult.reason);
        errors.push('購入記録の取得に失敗しました');
      }

      // DrinkingRecord の処理
      const drinkingResult = results[1];
      if (drinkingResult.status === 'fulfilled') {
        allRecords.push(...drinkingResult.value.map(toDrinkingUnifiedRecord));
      } else {
        console.error('DrinkingRecord list failed:', drinkingResult.reason);
        errors.push('飲酒記録の取得に失敗しました');
      }

      setRecords(allRecords);
      setError(errors.length > 0 ? errors.join('。') : null);
      setIsLoading(false);
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [reloadCount]);

  const refetch = useCallback(() => {
    setReloadCount((count) => count + 1);
  }, []);

  return { records, isLoading, error, refetch };
}
