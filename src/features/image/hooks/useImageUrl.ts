import { useState, useEffect } from 'react';
import { fetchDownloadUrl } from '../lib/downloadUrlCache';

export interface UseImageUrlReturn {
  /** 画像の Presigned URL */
  imageUrl: string | null;
  /** 読み込み中フラグ */
  isLoading: boolean;
  /** エラーフラグ */
  hasError: boolean;
}

/**
 * ダウンロード用 Presigned URL を取得するカスタムフック
 *
 * imageKey を受け取り、Presigned URL を取得する。
 * imageKey が null / undefined の場合は URL 取得をスキップする。
 *
 * 同じタイミングで要求されたキーは downloadUrlCache 側で 1 リクエストに
 * まとめられるため、カードごとに呼んでも Lambda の呼び出しは増えない。
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
        const url = await fetchDownloadUrl(imageKey);

        if (cancelled) return;

        setImageUrl(url);
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
