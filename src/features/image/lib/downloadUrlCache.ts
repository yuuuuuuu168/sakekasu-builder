import { generateClient } from 'aws-amplify/api';
import { getDownloadUrl } from '@/graphql/queries';

const client = generateClient();

/**
 * Presigned URL をメモリ保持する時間（ミリ秒）。
 * サーバー側の有効期限（DOWNLOAD_EXPIRY = 3600 秒）より短くして、
 * 期限切れ URL を掴まないようにする。
 */
const URL_TTL_MS = 50 * 60 * 1000;

interface CacheEntry {
  url: string;
  expiresAt: number;
}

/** 取得済み URL のキャッシュ（キー → URL） */
const urlCache = new Map<string, CacheEntry>();
/** 取得中のリクエスト（同一キーの同時リクエストを1本にまとめる） */
const inflight = new Map<string, Promise<string>>();

interface GetDownloadUrlResponse {
  getDownloadUrl: string;
}

async function requestDownloadUrl(key: string): Promise<string> {
  const result = await client.graphql({
    query: getDownloadUrl,
    variables: { key },
  });
  return (result as { data: GetDownloadUrlResponse }).data.getDownloadUrl;
}

/**
 * Presigned URL を取得する。有効期限内であればキャッシュを再利用し、
 * 同じキーへの同時リクエストは1本に束ねる。
 *
 * Presigned URL は署名が毎回変わりブラウザキャッシュが効かないため、
 * 再取得を減らすことが画像の再ダウンロード削減に直結する。
 */
export async function fetchDownloadUrl(key: string): Promise<string> {
  const cached = urlCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  const pending = inflight.get(key);
  if (pending) {
    return pending;
  }

  const request = requestDownloadUrl(key)
    .then((url) => {
      urlCache.set(key, { url, expiresAt: Date.now() + URL_TTL_MS });
      inflight.delete(key);
      return url;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, request);
  return request;
}

/** キャッシュを破棄する（テスト用途） */
export function clearDownloadUrlCache(): void {
  urlCache.clear();
  inflight.clear();
}
