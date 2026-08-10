import { describe, it, expect, vi, beforeEach } from 'vitest';

const graphqlMock = vi.fn();
vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: (...args: unknown[]) => graphqlMock(...args) }),
}));

const { fetchDownloadUrl, clearDownloadUrlCache } = await import(
  '../lib/downloadUrlCache'
);

/** 呼び出し引数から keys を取り出す */
function keysOf(call: unknown[]): string[] {
  return (call[0] as { variables: { keys: string[] } }).variables.keys;
}

/** 渡された keys の順に URL を返す（サーバー側の取り決めと同じ並び） */
function respondInOrder(): void {
  graphqlMock.mockImplementation(async (arg: { variables: { keys: string[] } }) => ({
    data: { getDownloadUrls: arg.variables.keys.map((key) => `https://example/${key}`) },
  }));
}

describe('fetchDownloadUrl', () => {
  beforeEach(() => {
    clearDownloadUrlCache();
    graphqlMock.mockReset();
  });

  it('同じキーの2回目はキャッシュを返し再取得しない', async () => {
    respondInOrder();

    const first = await fetchDownloadUrl('u/p/r/a.jpg');
    const second = await fetchDownloadUrl('u/p/r/a.jpg');

    expect(first).toBe('https://example/u/p/r/a.jpg');
    expect(second).toBe('https://example/u/p/r/a.jpg');
    expect(graphqlMock).toHaveBeenCalledTimes(1);
  });

  // 一覧では画像の数だけ URL を要求する。1件ずつ投げると Lambda の同時実行枠を
  // 使い切ってスロットリングされ、URL を取れなかった画像が表示されなくなる
  it('同じタイミングで要求された別々のキーは1リクエストにまとまる', async () => {
    respondInOrder();

    const results = await Promise.all([
      fetchDownloadUrl('u/p/r/a.jpg'),
      fetchDownloadUrl('u/p/r/b.jpg'),
      fetchDownloadUrl('u/p/r/c.jpg'),
    ]);

    expect(results).toEqual([
      'https://example/u/p/r/a.jpg',
      'https://example/u/p/r/b.jpg',
      'https://example/u/p/r/c.jpg',
    ]);
    expect(graphqlMock).toHaveBeenCalledTimes(1);
    expect(keysOf(graphqlMock.mock.calls[0])).toEqual([
      'u/p/r/a.jpg',
      'u/p/r/b.jpg',
      'u/p/r/c.jpg',
    ]);
  });

  it('同一キーへの同時リクエストは1本にまとめる', async () => {
    respondInOrder();

    const results = await Promise.all([
      fetchDownloadUrl('u/p/r/a.jpg'),
      fetchDownloadUrl('u/p/r/a.jpg'),
      fetchDownloadUrl('u/p/r/a.jpg'),
    ]);

    expect(results).toEqual([
      'https://example/u/p/r/a.jpg',
      'https://example/u/p/r/a.jpg',
      'https://example/u/p/r/a.jpg',
    ]);
    expect(graphqlMock).toHaveBeenCalledTimes(1);
    expect(keysOf(graphqlMock.mock.calls[0])).toEqual(['u/p/r/a.jpg']);
  });

  // サーバー側の上限は 100。まとめすぎて弾かれないよう 50 件ずつに割る
  it('50件を超える要求は複数リクエストに割る', async () => {
    respondInOrder();

    const keys = Array.from({ length: 125 }, (_, i) => `u/p/r/${i}.jpg`);
    const results = await Promise.all(keys.map(fetchDownloadUrl));

    expect(results).toEqual(keys.map((key) => `https://example/${key}`));
    expect(graphqlMock).toHaveBeenCalledTimes(3);
    expect(graphqlMock.mock.calls.map((call) => keysOf(call).length)).toEqual([50, 50, 25]);
  });

  it('失敗した場合はキャッシュせず次回に再取得する', async () => {
    graphqlMock.mockRejectedValueOnce(new Error('network'));
    await expect(fetchDownloadUrl('u/p/r/a.jpg')).rejects.toThrow('network');

    respondInOrder();
    expect(await fetchDownloadUrl('u/p/r/a.jpg')).toBe('https://example/u/p/r/a.jpg');
    expect(graphqlMock).toHaveBeenCalledTimes(2);
  });

  // 戻りが keys と一対一で返らない場合、ずれた URL を配ると別の記録の画像が出る
  it('戻りに欠けがある場合はそのキーだけ失敗させる', async () => {
    graphqlMock.mockResolvedValueOnce({
      data: { getDownloadUrls: ['https://example/a'] },
    });

    const [a, b] = await Promise.allSettled([
      fetchDownloadUrl('u/p/r/a.jpg'),
      fetchDownloadUrl('u/p/r/b.jpg'),
    ]);

    expect(a).toMatchObject({ status: 'fulfilled', value: 'https://example/a' });
    expect(b.status).toBe('rejected');
  });

  it('バッチ全体が失敗しても後続の要求は再試行できる', async () => {
    graphqlMock.mockRejectedValueOnce(new Error('network'));

    const settled = await Promise.allSettled([
      fetchDownloadUrl('u/p/r/a.jpg'),
      fetchDownloadUrl('u/p/r/b.jpg'),
    ]);

    expect(settled.map((r) => r.status)).toEqual(['rejected', 'rejected']);

    respondInOrder();
    expect(await fetchDownloadUrl('u/p/r/a.jpg')).toBe('https://example/u/p/r/a.jpg');
  });
});
