import { describe, it, expect, vi, beforeEach } from 'vitest';

const graphqlMock = vi.fn();
vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: (...args: unknown[]) => graphqlMock(...args) }),
}));

const { fetchDownloadUrl, clearDownloadUrlCache } = await import(
  '../lib/downloadUrlCache'
);

describe('fetchDownloadUrl', () => {
  beforeEach(() => {
    clearDownloadUrlCache();
    graphqlMock.mockReset();
  });

  it('同じキーの2回目はキャッシュを返し再取得しない', async () => {
    graphqlMock.mockResolvedValue({ data: { getDownloadUrl: 'https://example/1' } });

    const first = await fetchDownloadUrl('u/p/r/a.jpg');
    const second = await fetchDownloadUrl('u/p/r/a.jpg');

    expect(first).toBe('https://example/1');
    expect(second).toBe('https://example/1');
    expect(graphqlMock).toHaveBeenCalledTimes(1);
  });

  it('異なるキーはそれぞれ取得する', async () => {
    graphqlMock
      .mockResolvedValueOnce({ data: { getDownloadUrl: 'https://example/a' } })
      .mockResolvedValueOnce({ data: { getDownloadUrl: 'https://example/b' } });

    expect(await fetchDownloadUrl('u/p/r/a.jpg')).toBe('https://example/a');
    expect(await fetchDownloadUrl('u/p/r/b.jpg')).toBe('https://example/b');
    expect(graphqlMock).toHaveBeenCalledTimes(2);
  });

  it('同一キーへの同時リクエストは1本にまとめる', async () => {
    graphqlMock.mockResolvedValue({ data: { getDownloadUrl: 'https://example/1' } });

    const results = await Promise.all([
      fetchDownloadUrl('u/p/r/a.jpg'),
      fetchDownloadUrl('u/p/r/a.jpg'),
      fetchDownloadUrl('u/p/r/a.jpg'),
    ]);

    expect(results).toEqual([
      'https://example/1',
      'https://example/1',
      'https://example/1',
    ]);
    expect(graphqlMock).toHaveBeenCalledTimes(1);
  });

  it('失敗した場合はキャッシュせず次回に再取得する', async () => {
    graphqlMock.mockRejectedValueOnce(new Error('network'));
    await expect(fetchDownloadUrl('u/p/r/a.jpg')).rejects.toThrow('network');

    graphqlMock.mockResolvedValueOnce({ data: { getDownloadUrl: 'https://example/1' } });
    expect(await fetchDownloadUrl('u/p/r/a.jpg')).toBe('https://example/1');
    expect(graphqlMock).toHaveBeenCalledTimes(2);
  });
});
