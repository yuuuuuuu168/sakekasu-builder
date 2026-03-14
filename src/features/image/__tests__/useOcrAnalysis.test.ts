/**
 * useOcrAnalysis フックのユニットテスト
 *
 * Validates: Requirements 5.1, 5.2, 5.3
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useOcrAnalysis } from '../hooks/useOcrAnalysis';

const { mockGraphql } = vi.hoisted(() => {
  const mockGraphql = vi.fn();
  return { mockGraphql };
});

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({
    graphql: mockGraphql,
  }),
}));

describe('useOcrAnalysis', () => {
  beforeEach(() => {
    mockGraphql.mockReset();
  });

  it('analyzeSakeLabel ミューテーションが imageKey 引数で正しく呼び出されること', async () => {
    mockGraphql.mockResolvedValueOnce({
      data: {
        analyzeSakeLabel: {
          sakeName: '獺祭',
          confidence: 0.95,
          rawTexts: ['獺祭', '純米大吟醸'],
        },
      },
    });

    const { result } = renderHook(() => useOcrAnalysis());

    await act(async () => {
      await result.current.analyzeImage('user-sub/test-image.jpg');
    });

    expect(mockGraphql).toHaveBeenCalledTimes(1);
    expect(mockGraphql).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { imageKey: 'user-sub/test-image.jpg' },
      }),
    );
  });

  it('成功時（sakeName あり）に ocrResult が設定され、ocrError が null であること', async () => {
    const expectedResult = {
      sakeName: '八海山',
      confidence: 0.88,
      rawTexts: ['八海山', '特別本醸造', '720ml'],
    };

    mockGraphql.mockResolvedValueOnce({
      data: { analyzeSakeLabel: expectedResult },
    });

    const { result } = renderHook(() => useOcrAnalysis());

    let returnValue: unknown;
    await act(async () => {
      returnValue = await result.current.analyzeImage('sub123/image.jpg');
    });

    expect(result.current.ocrResult).toEqual(expectedResult);
    expect(result.current.ocrError).toBeNull();
    expect(returnValue).toEqual(expectedResult);
  });

  it('銘柄名未検出時（sakeName === null）に ocrError が設定されること', async () => {
    mockGraphql.mockResolvedValueOnce({
      data: {
        analyzeSakeLabel: {
          sakeName: null,
          confidence: 0.0,
          rawTexts: [],
        },
      },
    });

    const { result } = renderHook(() => useOcrAnalysis());

    await act(async () => {
      await result.current.analyzeImage('sub/img.jpg');
    });

    expect(result.current.ocrError).toBe(
      '銘柄名を読み取れませんでした。手動で入力してください',
    );
    expect(result.current.ocrResult).toEqual({
      sakeName: null,
      confidence: 0.0,
      rawTexts: [],
    });
  });

  it('ネットワークエラー時に ocrError が設定されること', async () => {
    mockGraphql.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useOcrAnalysis());

    await act(async () => {
      const ret = await result.current.analyzeImage('sub/img.jpg');
      expect(ret).toBeNull();
    });

    expect(result.current.ocrError).toBe(
      '読み取りに失敗しました。もう一度お試しください',
    );
    expect(result.current.ocrResult).toBeNull();
  });

  it('タイムアウト時に ocrError が設定されること', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    mockGraphql.mockRejectedValueOnce(abortError);

    const { result } = renderHook(() => useOcrAnalysis());

    await act(async () => {
      const ret = await result.current.analyzeImage('sub/img.jpg');
      expect(ret).toBeNull();
    });

    expect(result.current.ocrError).toBe(
      '読み取りがタイムアウトしました。もう一度お試しください',
    );
    expect(result.current.ocrResult).toBeNull();
  });

  it('resetOcr で状態がリセットされること', async () => {
    mockGraphql.mockResolvedValueOnce({
      data: {
        analyzeSakeLabel: {
          sakeName: '久保田',
          confidence: 0.9,
          rawTexts: ['久保田'],
        },
      },
    });

    const { result } = renderHook(() => useOcrAnalysis());

    await act(async () => {
      await result.current.analyzeImage('sub/img.jpg');
    });

    expect(result.current.ocrResult).not.toBeNull();

    act(() => {
      result.current.resetOcr();
    });

    expect(result.current.ocrResult).toBeNull();
    expect(result.current.ocrError).toBeNull();
    expect(result.current.isAnalyzing).toBe(false);
  });

  it('解析中に isAnalyzing が true になること', async () => {
    let resolveGraphql!: (value: unknown) => void;
    mockGraphql.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveGraphql = resolve;
      }),
    );

    const { result } = renderHook(() => useOcrAnalysis());

    // analyzeImage を開始するが await しない
    let analyzePromise: Promise<unknown>;
    act(() => {
      analyzePromise = result.current.analyzeImage('sub/img.jpg');
    });

    // 解析中は isAnalyzing が true
    expect(result.current.isAnalyzing).toBe(true);

    // resolve して完了させる
    await act(async () => {
      resolveGraphql({
        data: {
          analyzeSakeLabel: {
            sakeName: '黒霧島',
            confidence: 0.85,
            rawTexts: ['黒霧島'],
          },
        },
      });
      await analyzePromise!;
    });

    expect(result.current.isAnalyzing).toBe(false);
  });
});
