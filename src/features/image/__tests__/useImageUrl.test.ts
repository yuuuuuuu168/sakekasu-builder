import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// vi.hoisted でモック関数を先に定義
const mockGraphql = vi.hoisted(() => vi.fn());

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({
    graphql: mockGraphql,
  }),
}));

import { useImageUrl } from '../hooks/useImageUrl';
import { clearDownloadUrlCache } from '../lib/downloadUrlCache';

describe('useImageUrl', () => {
  beforeEach(() => {
    mockGraphql.mockReset();
    // Presigned URL はモジュールレベルでキャッシュされるため、
    // テスト間で前のケースの URL を引かないよう破棄する
    clearDownloadUrlCache();
  });

  it('imageKey が null の場合は URL 取得をスキップする', () => {
    const { result } = renderHook(() => useImageUrl(null));

    expect(result.current.imageUrl).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.hasError).toBe(false);
    expect(mockGraphql).not.toHaveBeenCalled();
  });

  it('imageKey が undefined の場合は URL 取得をスキップする', () => {
    const { result } = renderHook(() => useImageUrl(undefined));

    expect(result.current.imageUrl).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.hasError).toBe(false);
    expect(mockGraphql).not.toHaveBeenCalled();
  });

  it('imageKey が指定された場合に Presigned URL を取得する', async () => {
    const mockUrl = 'https://s3.example.com/presigned-url';
    mockGraphql.mockResolvedValueOnce({
      data: { getDownloadUrl: mockUrl },
    });

    const { result } = renderHook(() => useImageUrl('user123/purchase/rec1/label.jpg'));

    // 初期状態: isLoading が true
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.imageUrl).toBe(mockUrl);
    expect(result.current.hasError).toBe(false);
    expect(mockGraphql).toHaveBeenCalledWith({
      query: expect.any(String),
      variables: { key: 'user123/purchase/rec1/label.jpg' },
    });
  });

  it('GraphQL クエリが失敗した場合に hasError を true にする', async () => {
    mockGraphql.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useImageUrl('user123/purchase/rec1/label.jpg'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.imageUrl).toBeNull();
    expect(result.current.hasError).toBe(true);
  });

  it('imageKey が変更されたら新しい URL を取得する', async () => {
    const mockUrl1 = 'https://s3.example.com/url1';
    const mockUrl2 = 'https://s3.example.com/url2';
    mockGraphql
      .mockResolvedValueOnce({ data: { getDownloadUrl: mockUrl1 } })
      .mockResolvedValueOnce({ data: { getDownloadUrl: mockUrl2 } });

    const { result, rerender } = renderHook(
      ({ key }) => useImageUrl(key),
      { initialProps: { key: 'key1' as string | null } },
    );

    await waitFor(() => {
      expect(result.current.imageUrl).toBe(mockUrl1);
    });

    rerender({ key: 'key2' });

    await waitFor(() => {
      expect(result.current.imageUrl).toBe(mockUrl2);
    });

    expect(mockGraphql).toHaveBeenCalledTimes(2);
  });

  it('imageKey が null に変更されたら状態をリセットする', async () => {
    const mockUrl = 'https://s3.example.com/presigned-url';
    mockGraphql.mockResolvedValueOnce({
      data: { getDownloadUrl: mockUrl },
    });

    const { result, rerender } = renderHook(
      ({ key }) => useImageUrl(key),
      { initialProps: { key: 'key1' as string | null } },
    );

    await waitFor(() => {
      expect(result.current.imageUrl).toBe(mockUrl);
    });

    rerender({ key: null });

    expect(result.current.imageUrl).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.hasError).toBe(false);
  });
});
