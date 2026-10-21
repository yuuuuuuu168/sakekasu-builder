// 一括処理の進み具合と控えの書き出し。
//
// 何を書けたとみなすかは呼び出し側（詳細スペック・テイスティングノート）の
// テストで見ている。ここでは数え方と、途中で落ちても控えを書き出すことを固定する

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useSequentialBackfill, type BackfillItemOutcome } from '../useSequentialBackfill';

describe('useSequentialBackfill', () => {
  it('結果ごとに数え、ignored は件数にも進み具合にも入れない', async () => {
    const { result } = renderHook(() => useSequentialBackfill());
    const outcomes: BackfillItemOutcome[] = ['written', 'skipped', 'ignored', 'written'];

    let progress;
    await act(async () => {
      progress = await result.current.runQueue(
        outcomes,
        async (outcome) => outcome,
        () => false,
      );
    });

    expect(progress).toEqual({ done: 3, total: 4, written: 2, skipped: 1 });
    expect(result.current.progress).toEqual({ done: 3, total: 4, written: 2, skipped: 1 });
    expect(result.current.isRunning).toBe(false);
  });

  it('1件ずつ直列に処理する', async () => {
    const { result } = renderHook(() => useSequentialBackfill());
    let inFlight = 0;
    let maxInFlight = 0;

    await act(async () => {
      await result.current.runQueue(
        [1, 2, 3],
        async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await Promise.resolve();
          inFlight -= 1;
          return 'written';
        },
        () => false,
      );
    });

    expect(maxInFlight).toBe(1);
  });

  it('控えを書き換えたときだけ skippedRevision を進める', async () => {
    const { result } = renderHook(() => useSequentialBackfill());
    const process = async (): Promise<BackfillItemOutcome> => 'skipped';

    await act(async () => {
      await result.current.runQueue([1], process, () => false);
    });
    expect(result.current.skippedRevision).toBe(0);

    await act(async () => {
      await result.current.runQueue([1], process, () => true);
    });
    expect(result.current.skippedRevision).toBe(1);
  });

  it('途中で例外が出ても控えを書き出し、実行中を解く', async () => {
    const { result } = renderHook(() => useSequentialBackfill());
    const saveSkips = vi.fn(() => true);

    await act(async () => {
      await expect(
        result.current.runQueue(
          [1, 2],
          async (n) => {
            if (n === 2) throw new Error('boom');
            return 'skipped';
          },
          saveSkips,
        ),
      ).rejects.toThrow('boom');
    });

    expect(saveSkips).toHaveBeenCalledTimes(1);
    expect(result.current.isRunning).toBe(false);
    expect(result.current.skippedRevision).toBe(1);
    expect(result.current.progress).toEqual({ done: 1, total: 2, written: 0, skipped: 1 });
  });
});
