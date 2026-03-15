import { useState, useEffect } from 'react';
import { generateClient } from 'aws-amplify/api';
import { getDownloadUrl } from '@/graphql/queries';

const client = generateClient();

export interface UseImageUrlsReturn {
  imageUrls: string[];
  isLoading: boolean;
  hasError: boolean;
}

interface GetDownloadUrlResponse {
  getDownloadUrl: string;
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
        const results = await Promise.all(
          imageKeys.map((key) =>
            client.graphql({
              query: getDownloadUrl,
              variables: { key },
            }),
          ),
        );

        if (cancelled) return;

        const urls = results.map(
          (r) => (r as { data: GetDownloadUrlResponse }).data.getDownloadUrl,
        );
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
