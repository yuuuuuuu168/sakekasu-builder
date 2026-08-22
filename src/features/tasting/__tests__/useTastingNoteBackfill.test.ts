/**
 * 一括追記のテスト。
 *
 * 対象1件につき「生成 → 備考の更新」の2呼び出しになる。書けなかった記録に
 * 更新を投げないこと、途中で失敗しても残りを続けることを見る。
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTastingNoteBackfill } from '../hooks/useTastingNoteBackfill';
import type { UnifiedRecord } from '@/features/records/types';

const { mockGraphql } = vi.hoisted(() => ({ mockGraphql: vi.fn() }));

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: mockGraphql }),
}));

function record(overrides: Partial<UnifiedRecord> = {}): UnifiedRecord {
  return {
    id: 'p-1',
    type: 'purchase',
    sakeName: '山崎 12年',
    price: 12000,
    date: '2026-01-10',
    category: 'WHISKY',
    imageKeys: [],
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
    ...overrides,
  };
}

/** 生成 → 更新の順で応答を積む */
function queueGenerated(tastingNote: string | null, recommendedServing: string | null = null) {
  mockGraphql.mockResolvedValueOnce({
    data: { generateTastingNote: { tastingNote, recommendedServing } },
  });
}

function queueUpdated() {
  mockGraphql.mockResolvedValueOnce({ data: { updatePurchaseRecord: { id: 'p-1' } } });
}

describe('useTastingNoteBackfill', () => {
  beforeEach(() => {
    mockGraphql.mockReset();
  });

  it('未記載の記録に追記し、画面へ反映する', async () => {
    queueGenerated('バニラと蜂蜜の香り', 'ストレートで');
    queueUpdated();
    const onMemoUpdated = vi.fn();

    const { result } = renderHook(() =>
      useTastingNoteBackfill([record({ memo: '近所の酒屋で購入' })], onMemoUpdated),
    );

    expect(result.current.targets).toHaveLength(1);

    await act(async () => {
      await result.current.run();
    });

    expect(onMemoUpdated).toHaveBeenCalledWith(
      'p-1',
      '近所の酒屋で購入\nテイスティングノート: バニラと蜂蜜の香り\nおすすめの飲み方: ストレートで',
    );
    expect(result.current.progress).toEqual({ done: 1, total: 1, written: 1, skipped: 0 });
  });

  // 更新の入力は id と memo だけ。全項目を送ると、一覧が持っていない項目を
  // 空で上書きしかねない
  it('備考だけを更新する', async () => {
    queueGenerated('華やかな吟醸香');
    queueUpdated();

    const { result } = renderHook(() =>
      useTastingNoteBackfill([record({ category: 'NIHONSHU' })], vi.fn()),
    );

    await act(async () => {
      await result.current.run();
    });

    expect(mockGraphql).toHaveBeenLastCalledWith(
      expect.objectContaining({
        variables: { input: { id: 'p-1', memo: 'テイスティングノート: 華やかな吟醸香' } },
      }),
    );
  });

  it('知らない銘柄では更新を投げない', async () => {
    queueGenerated(null);
    const onMemoUpdated = vi.fn();

    const { result } = renderHook(() =>
      useTastingNoteBackfill([record({ sakeName: '聞いたことのない酒' })], onMemoUpdated),
    );

    await act(async () => {
      await result.current.run();
    });

    // 生成の1回だけ。更新は投げていない
    expect(mockGraphql).toHaveBeenCalledTimes(1);
    expect(onMemoUpdated).not.toHaveBeenCalled();
    expect(result.current.progress).toEqual({ done: 1, total: 1, written: 0, skipped: 1 });
  });

  it('1件失敗しても残りを続ける', async () => {
    // 1件目: 生成で失敗 → 2件目: 生成 → 更新
    mockGraphql.mockRejectedValueOnce(new Error('boom'));
    queueGenerated('バニラの香り');
    queueUpdated();
    const onMemoUpdated = vi.fn();

    const { result } = renderHook(() =>
      useTastingNoteBackfill(
        [record({ id: 'p-1' }), record({ id: 'p-2', sakeName: '白州' })],
        onMemoUpdated,
      ),
    );

    await act(async () => {
      await result.current.run();
    });

    expect(onMemoUpdated).toHaveBeenCalledTimes(1);
    expect(onMemoUpdated).toHaveBeenCalledWith('p-2', 'テイスティングノート: バニラの香り');
    expect(result.current.progress).toEqual({ done: 2, total: 2, written: 1, skipped: 1 });
  });

  it('対象が無ければ何も呼ばない', async () => {
    const { result } = renderHook(() =>
      useTastingNoteBackfill([record({ category: 'BEER' })], vi.fn()),
    );

    expect(result.current.targets).toEqual([]);

    await act(async () => {
      await result.current.run();
    });

    expect(mockGraphql).not.toHaveBeenCalled();
  });
});
