import { generateClient } from 'aws-amplify/api';
import { getDownloadUrls } from '@/graphql/queries';

const client = generateClient();

/**
 * Presigned URL をメモリ保持する時間（ミリ秒）。
 * サーバー側の有効期限（DOWNLOAD_EXPIRY = 3600 秒）より短くして、
 * 期限切れ URL を掴まないようにする。
 */
const URL_TTL_MS = 50 * 60 * 1000;

/**
 * 1 リクエストにまとめるキーの上限。
 *
 * サーバー側（presigned-url Lambda）の上限は 100。余裕を持たせて 50 にし、
 * 超える分は複数リクエストに割る。記録が 125 件あっても 3 回で済む
 */
const MAX_BATCH_SIZE = 50;

interface CacheEntry {
  url: string;
  expiresAt: number;
}

/** 取得済み URL のキャッシュ（キー → URL） */
const urlCache = new Map<string, CacheEntry>();
/** 取得中のリクエスト（同一キーの同時リクエストを1本にまとめる） */
const inflight = new Map<string, Promise<string>>();

/** 次のバッチに載せるキーと、その解決先 */
const pending = new Map<string, { resolve: (url: string) => void; reject: (err: unknown) => void }>();
/** バッチ送信を予約済みか */
let flushScheduled = false;

interface GetDownloadUrlsResponse {
  getDownloadUrls: string[];
}

async function requestDownloadUrls(keys: string[]): Promise<string[]> {
  const result = await client.graphql({
    query: getDownloadUrls,
    variables: { keys },
  });
  return (result as { data: GetDownloadUrlsResponse }).data.getDownloadUrls;
}

/** 1 バッチ分を送って、キーごとの待ち手を解決する */
async function sendBatch(
  entries: [string, { resolve: (url: string) => void; reject: (err: unknown) => void }][],
): Promise<void> {
  const keys = entries.map(([key]) => key);

  try {
    const urls = await requestDownloadUrls(keys);

    entries.forEach(([key, handlers], index) => {
      const url = urls[index];
      inflight.delete(key);

      // 戻りは keys と一対一で返る取り決め。欠けている場合は
      // 黙って undefined を配らず、その1件だけ失敗にする
      if (typeof url !== 'string') {
        handlers.reject(new Error(`No download URL returned for key: ${key}`));
        return;
      }

      urlCache.set(key, { url, expiresAt: Date.now() + URL_TTL_MS });
      handlers.resolve(url);
    });
  } catch (err) {
    entries.forEach(([key, handlers]) => {
      inflight.delete(key);
      handlers.reject(err);
    });
  }
}

/** 溜まったキーをバッチに割って送る */
function flush(): void {
  flushScheduled = false;

  const entries = [...pending.entries()];
  pending.clear();

  for (let i = 0; i < entries.length; i += MAX_BATCH_SIZE) {
    void sendBatch(entries.slice(i, i + MAX_BATCH_SIZE));
  }
}

/**
 * Presigned URL を取得する。有効期限内であればキャッシュを再利用し、
 * 同じキーへの同時リクエストは1本に束ねる。
 *
 * 呼び出しは即時に投げず、同じタイミングで要求されたキーを 1 回の
 * getDownloadUrls にまとめる。一覧では画像の数だけ Lambda を呼ぶことになり、
 * アカウントの同時実行枠（10）を使い切って大半がスロットリングされ、
 * URL を取れなかったカードの画像が出なくなっていた。
 *
 * Presigned URL は署名が毎回変わりブラウザキャッシュが効かないため、
 * 再取得を減らすことが画像の再ダウンロード削減に直結する。
 */
export function fetchDownloadUrl(key: string): Promise<string> {
  const cached = urlCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.url);
  }

  const inflightRequest = inflight.get(key);
  if (inflightRequest) {
    return inflightRequest;
  }

  const request = new Promise<string>((resolve, reject) => {
    pending.set(key, { resolve, reject });
  });

  inflight.set(key, request);

  if (!flushScheduled) {
    flushScheduled = true;
    // 同じレンダリングで走った useEffect の要求をまとめてから送る
    queueMicrotask(flush);
  }

  return request;
}

/** キャッシュを破棄する（テスト用途） */
export function clearDownloadUrlCache(): void {
  urlCache.clear();
  inflight.clear();
  pending.clear();
  flushScheduled = false;
}
