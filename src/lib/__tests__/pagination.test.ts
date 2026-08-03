import { describe, it, expect, vi } from 'vitest';
import { fetchAllPages, MAX_PAGES } from '../pagination';

describe('fetchAllPages', () => {
  it('nextToken がない場合は1ページで完了する', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: [1, 2, 3], nextToken: null });
    const result = await fetchAllPages<number>(fetchPage);
    expect(result).toEqual([1, 2, 3]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(null);
  });

  it('nextToken が続く限り全ページを取得して結合する', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [1, 2], nextToken: 'token-1' })
      .mockResolvedValueOnce({ items: [3, 4], nextToken: 'token-2' })
      .mockResolvedValueOnce({ items: [5], nextToken: null });
    const result = await fetchAllPages<number>(fetchPage);
    expect(result).toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'token-1');
    expect(fetchPage).toHaveBeenNthCalledWith(3, 'token-2');
  });

  it('レスポンスが欠損（undefined）の場合はそこで打ち切る', async () => {
    const fetchPage = vi.fn().mockResolvedValue(undefined);
    const result = await fetchAllPages<number>(fetchPage);
    expect(result).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('MAX_PAGES を超えたら警告を出して打ち切る', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchPage = vi.fn().mockResolvedValue({ items: [1], nextToken: 'more' });
    const result = await fetchAllPages<number>(fetchPage);
    expect(result).toHaveLength(MAX_PAGES);
    expect(fetchPage).toHaveBeenCalledTimes(MAX_PAGES);
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it('ページ取得が reject した場合はエラーが伝播する', async () => {
    const fetchPage = vi.fn().mockRejectedValue(new Error('network error'));
    await expect(fetchAllPages<number>(fetchPage)).rejects.toThrow('network error');
  });
});
