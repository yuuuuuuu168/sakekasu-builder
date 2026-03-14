import { useState, useEffect } from 'react';
import { generateClient } from 'aws-amplify/api';
import { getDownloadUrl } from '@/graphql/queries';

const client = generateClient();

export interface UseImageUrlReturn {
  /** 画像の Presigned URL */
  imageUrl: string | null;
  /** 読み込み中フラグ */
  isLoading: boolean;
  /** エラーフラグ */
  hasError: boolean;
}

interface GetDownloadUrlResponse {
  getDownloadUrl: string;
}

/**
 * ダウンロード用 Presigned URL を取得するカスタムフック
 *
 * imageKey を受け取り、getDownloadUrl クエリで Presigned URL を取得する。
 * imageKey が null / undefined の場合は URL 取得をスキップする。
 *
 * Validates: Requirements 4.1, 4.4, 4.5
 */
export function useImageUrl(imageKey: string | null | undefined): UseImageUrlReturn {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    // imageKey が null / undefined の場合はスキップ
    if (!imageKey) {
      setImageUrl(null);
      setIsLoading(false);
      setHasError(false);
      return;
    }

    let cancelled = false;

    const fetchUrl = async () => {
      setIsLoading(true);
      setHasError(false);

      try {
        const result = await client.graphql({
          query: getDownloadUrl,
          variables: { key: imageKey },
        });

        if (cancelled) return;

        const response = result as { data: GetDownloadUrlResponse };
        setImageUrl(response.data.getDownloadUrl);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to fetch download URL:', err);
        setHasError(true);
        setImageUrl(null);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchUrl();

    return () => {
      cancelled = true;
    };
  }, [imageKey]);

  return { imageUrl, isLoading, hasError };
}
