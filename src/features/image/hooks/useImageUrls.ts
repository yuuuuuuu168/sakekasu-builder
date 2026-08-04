import { useState, useEffect } from 'react';
import { fetchDownloadUrl } from '../lib/downloadUrlCache';

export interface UseImageUrlsReturn {
  imageUrls: string[];
  isLoading: boolean;
  hasError: boolean;
}

/**
 * 複数の imageKey から Presigned URL を一括取得するフック
 */
export function useImageUrls(imageKeys: string[]): UseImageUrlsReturn {
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (imageKeys.length === 0) {
      setImageUrls([]);
      setIsLoading(false);
      setHasError(false);
      return;
    }

    let cancelled = false;

    const fetchUrls = async () => {
      setIsLoading(true);
      setHasError(false);

      try {
        const urls = await Promise.all(imageKeys.map(fetchDownloadUrl));

        if (cancelled) return;

        setImageUrls(urls);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to fetch download URLs:', err);
        setHasError(true);
        setImageUrls([]);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchUrls();

    return () => {
      cancelled = true;
    };
  }, [imageKeys.join(',')]);

  return { imageUrls, isLoading, hasError };
}
