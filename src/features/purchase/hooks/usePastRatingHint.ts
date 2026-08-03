import { useEffect, useMemo, useRef, useState } from 'react';
import { generateClient } from 'aws-amplify/api';
import { listDrinkingRecords } from '@/graphql/queries';
import type { DrinkingRecordType } from '@/types/schema';
import { findPastRatings, MIN_QUERY_LENGTH } from '../lib/pastRatings';
import type { PastRatingSummary } from '../lib/pastRatings';

const client = generateClient();

/** 銘柄名入力のデバウンス間隔（ms） */
const DEBOUNCE_MS = 300;

interface ListDrinkingRecordsResponse {
  listDrinkingRecords: DrinkingRecordType[];
}

/**
 * 購入フォームの銘柄名入力に反応して、過去の飲酒評価サマリを返す。
 *
 * - 飲酒記録の取得は最初に有効な入力があった時に1回だけ（遅延フェッチ）
 * - 取得失敗時はヒント非表示のまま（ベストエフォートなのでエラー表示しない）
 */
export function usePastRatingHint(sakeName: string): { summaries: PastRatingSummary[] } {
  const [records, setRecords] = useState<DrinkingRecordType[] | null>(null);
  const [debouncedName, setDebouncedName] = useState(sakeName);
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedName(sakeName), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [sakeName]);

  const shouldFetch = debouncedName.trim().length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    if (!shouldFetch || hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    let cancelled = false;
    client
      .graphql({ query: listDrinkingRecords })
      .then((response) => {
        const data = (response as { data: ListDrinkingRecordsResponse }).data;
        if (!cancelled && data?.listDrinkingRecords) {
          setRecords(data.listDrinkingRecords);
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to fetch drinking records for rating hint:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [shouldFetch]);

  const summaries = useMemo(
    () => (records ? findPastRatings(records, debouncedName) : []),
    [records, debouncedName],
  );

  return { summaries };
}
