/**
 * 写真からの詳細スペック一括読み取りのテスト。
 *
 * 対象1件につき「解析 → スペックの更新」の2呼び出しになる。読めなかった記録に
 * 更新を投げないこと、控えたぶんを次回の対象から外すこと、途中で失敗しても
 * 残りを続けることを見る。
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSpecBackfill } from '../hooks/useSpecBackfill';
import { pickSakeSpecs } from '../lib/sakeSpecs';
import type { UnifiedRecord } from '@/features/records/types';

const { mockGraphql } = vi.hoisted(() => ({ mockGraphql: vi.fn() }));

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: mockGraphql }),
}));

// 「読めなかった記録」はユーザーごとに localStorage へ控えるため、認証を差し替える
vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'user-1' } }),
}));

function record(overrides: Partial<UnifiedRecord> = {}): UnifiedRecord {
  return {
    id: 'p-1',
    type: 'purchase',
    sakeName: '獺祭 純米大吟醸',
    price: 3300,
    date: '2026-01-10',
    category: 'NIHONSHU',
    imageKeys: ['sub-1/purchase/p-1/front.jpg'],
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * 解析の応答を積む。null の項目は読めなかったぶん。
 *
 * 一括読み取りは確信度の低い項目を書かないので、値のある項目には十分な
 * 確信度を添える（低確信度の扱いは専用のテストで見る）
 */
function queueAnalyzed(specs: Record<string, unknown>, confidence?: Record<string, number>) {
  const fieldConfidence =
    confidence ??
    Object.fromEntries(
      Object.entries(specs)
        .filter(([, value]) => value != null)
        .map(([key]) => [key, 0.95]),
    );
  mockGraphql.mockResolvedValueOnce({
    data: { analyzeSakeLabel: { sakeName: '獺祭 純米大吟醸', ...specs, fieldConfidence } },
  });
}

function queueUpdated() {
  mockGraphql.mockResolvedValueOnce({ data: { updatePurchaseRecord: { id: 'p-1' } } });
}

/** 直近の呼び出しで送られた input */
function lastInput(): Record<string, unknown> {
  const call = mockGraphql.mock.calls[mockGraphql.mock.calls.length - 1][0] as {
    variables: { input: Record<string, unknown> };
  };
  return call.variables.input;
}

describe('useSpecBackfill', () => {
  beforeEach(() => {
    mockGraphql.mockReset();
    localStorage.clear();
  });

  it('写真から読み取ったスペックを書き込み、画面へ反映する', async () => {
    queueAnalyzed({ brewery: '旭酒造株式会社', ricePolishingRatio: 23 });
    queueUpdated();
    const onSpecsUpdated = vi.fn();

    const { result } = renderHook(() => useSpecBackfill([record()], onSpecsUpdated));

    expect(result.current.targets).toHaveLength(1);

    await act(async () => {
      const progress = await result.current.run();
      expect(progress.written).toBe(1);
    });

    expect(onSpecsUpdated).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ brewery: '旭酒造株式会社', ricePolishingRatio: 23 }),
    );
  });

  it('読み取れた項目だけを送る（手入力を消さないため null は送らない）', async () => {
    queueAnalyzed({ brewery: '旭酒造株式会社', yeast: null, acidity: null });
    queueUpdated();

    const { result } = renderHook(() => useSpecBackfill([record()], vi.fn()));
    await act(async () => {
      await result.current.run();
    });

    const input = lastInput();
    expect(input.brewery).toBe('旭酒造株式会社');
    expect('yeast' in input).toBe(false);
    expect('acidity' in input).toBe(false);
  });

  it('飲酒記録は飲酒側の更新に送る', async () => {
    queueAnalyzed({ brewery: '旭酒造株式会社' });
    mockGraphql.mockResolvedValueOnce({ data: { updateDrinkingRecord: { id: 'd-1' } } });

    const { result } = renderHook(() =>
      useSpecBackfill([record({ id: 'd-1', type: 'drinking' })], vi.fn()),
    );
    await act(async () => {
      await result.current.run();
    });

    const call = mockGraphql.mock.calls[1][0] as { query: string };
    expect(call.query).toContain('UpdateDrinkingRecord');
  });

  it('何も読めなかった記録には更新を投げず、次回の対象から外す', async () => {
    queueAnalyzed({ brewery: null });
    const onSpecsUpdated = vi.fn();

    const { result, rerender } = renderHook(() =>
      useSpecBackfill([record()], onSpecsUpdated),
    );

    await act(async () => {
      const progress = await result.current.run();
      expect(progress.written).toBe(0);
      expect(progress.skipped).toBe(1);
    });

    // 解析の1回だけ。更新は投げない
    expect(mockGraphql).toHaveBeenCalledTimes(1);
    expect(onSpecsUpdated).not.toHaveBeenCalled();

    rerender();
    expect(result.current.targets).toHaveLength(0);
    expect(result.current.skippedCount).toBe(1);
  });

  it('銘柄名が読めない写真（裏ラベルのみ等）も読めなかった扱いになる', async () => {
    // 銘柄名が読めないと Lambda 側が他の項目も採用しないため、全項目 null で返る
    mockGraphql.mockResolvedValueOnce({
      data: { analyzeSakeLabel: { sakeName: null, brewery: null, fieldConfidence: {} } },
    });

    const { result } = renderHook(() => useSpecBackfill([record()], vi.fn()));
    await act(async () => {
      const progress = await result.current.run();
      expect(progress.written).toBe(0);
    });

    expect(mockGraphql).toHaveBeenCalledTimes(1);
  });

  it('解析の呼び出しが失敗した記録は控えない（やり直せば結果が変わりうる）', async () => {
    mockGraphql.mockRejectedValueOnce(new Error('boom'));

    const { result, rerender } = renderHook(() => useSpecBackfill([record()], vi.fn()));

    await act(async () => {
      const progress = await result.current.run();
      expect(progress.skipped).toBe(1);
    });

    rerender();
    expect(result.current.targets).toHaveLength(1);
  });

  it('保存に失敗した記録も控えない', async () => {
    queueAnalyzed({ brewery: '旭酒造株式会社' });
    mockGraphql.mockResolvedValueOnce({ errors: [{ message: 'boom' }] });

    const { result, rerender } = renderHook(() => useSpecBackfill([record()], vi.fn()));

    await act(async () => {
      const progress = await result.current.run();
      expect(progress.written).toBe(0);
      expect(progress.skipped).toBe(1);
    });

    rerender();
    expect(result.current.targets).toHaveLength(1);
  });

  it('途中で失敗しても残りの記録を続ける', async () => {
    mockGraphql.mockRejectedValueOnce(new Error('boom'));
    queueAnalyzed({ brewery: '旭酒造株式会社' });
    mockGraphql.mockResolvedValueOnce({ data: { updatePurchaseRecord: { id: 'p-2' } } });

    const { result } = renderHook(() =>
      useSpecBackfill(
        [record(), record({ id: 'p-2', imageKeys: ['sub-1/purchase/p-2/front.jpg'] })],
        vi.fn(),
      ),
    );

    await act(async () => {
      const progress = await result.current.run();
      expect(progress.done).toBe(2);
      expect(progress.written).toBe(1);
      expect(progress.skipped).toBe(1);
    });
  });

  it('すでにスペックが入っている記録は対象にしない', () => {
    const { result } = renderHook(() =>
      useSpecBackfill([record({ specs: pickSakeSpecs({ brewery: '旭酒造株式会社' }) })], vi.fn()),
    );

    expect(result.current.targets).toHaveLength(0);
  });

  it('複数枚の写真をまとめて1回の解析に渡す', async () => {
    queueAnalyzed({ brewery: '旭酒造株式会社' });
    queueUpdated();

    const { result } = renderHook(() =>
      useSpecBackfill(
        [record({ imageKeys: ['sub-1/purchase/p-1/front.jpg', 'sub-1/purchase/p-1/back.jpg'] })],
        vi.fn(),
      ),
    );

    await act(async () => {
      await result.current.run();
    });

    const call = mockGraphql.mock.calls[0][0] as {
      variables: { imageKey: string; additionalImageKeys: string[] };
    };
    expect(call.variables.imageKey).toBe('sub-1/purchase/p-1/front.jpg');
    expect(call.variables.additionalImageKeys).toEqual(['sub-1/purchase/p-1/back.jpg']);
  });

  it('確信度の低い項目は書き込まない（人の目を経ずに保存まで進むため）', async () => {
    queueAnalyzed(
      { brewery: '旭酒造株式会社', ricePolishingRatio: 23 },
      { brewery: 0.95, ricePolishingRatio: 0.5 },
    );
    queueUpdated();

    const { result } = renderHook(() => useSpecBackfill([record()], vi.fn()));
    await act(async () => {
      await result.current.run();
    });

    const input = lastInput();
    expect(input.brewery).toBe('旭酒造株式会社');
    expect('ricePolishingRatio' in input).toBe(false);
  });

  it('確信度がちょうど 0.7 の項目は書き込む（境界値）', async () => {
    queueAnalyzed({ ricePolishingRatio: 23 }, { ricePolishingRatio: 0.7 });
    queueUpdated();

    const { result } = renderHook(() => useSpecBackfill([record()], vi.fn()));
    await act(async () => {
      await result.current.run();
    });

    expect(lastInput().ricePolishingRatio).toBe(23);
  });

  it('全項目が低確信度なら、読めなかった扱いで更新を投げない', async () => {
    queueAnalyzed({ brewery: '旭酒造株式会社' }, { brewery: 0.4 });

    const { result } = renderHook(() => useSpecBackfill([record()], vi.fn()));
    await act(async () => {
      const progress = await result.current.run();
      expect(progress.written).toBe(0);
    });

    expect(mockGraphql).toHaveBeenCalledTimes(1);
  });
});

// Feature: 読み取りの精度を上げたあとに、以前の結果を正す
describe('useSpecBackfill の読み直し', () => {
  beforeEach(() => {
    mockGraphql.mockReset();
    localStorage.clear();
  });

  it('すでにスペックが入っている記録も対象にする', () => {
    const { result } = renderHook(() =>
      useSpecBackfill([record({ specs: pickSakeSpecs({ brewery: '誤った蔵元' }) })], vi.fn()),
    );

    expect(result.current.targets).toHaveLength(0);
    expect(result.current.rereadTargets).toHaveLength(1);
  });

  it('読み取れなかった項目は空にして入れ替える（誤った値を残さない）', async () => {
    queueAnalyzed({ brewery: '旭酒造株式会社' });
    queueUpdated();

    const { result } = renderHook(() =>
      useSpecBackfill(
        [record({ specs: pickSakeSpecs({ brewery: '誤った蔵元', ricePolishingRatio: 60 }) })],
        vi.fn(),
      ),
    );

    await act(async () => {
      await result.current.run({ reread: true });
    });

    const input = lastInput();
    expect(input.brewery).toBe('旭酒造株式会社');
    // 読めなかった項目は null を送って消す
    expect(input.ricePolishingRatio).toBeNull();
    expect(input.yeast).toBeNull();
  });

  it('何も読めなくても空で入れ替える', async () => {
    queueAnalyzed({ brewery: null });
    queueUpdated();

    const { result } = renderHook(() =>
      useSpecBackfill([record({ specs: pickSakeSpecs({ ricePolishingRatio: 60 }) })], vi.fn()),
    );

    await act(async () => {
      await result.current.run({ reread: true });
    });

    expect(lastInput().ricePolishingRatio).toBeNull();
  });

  it('一度読み直したら案内を出さない（用が済んだあとも出し続けない）', async () => {
    queueAnalyzed({ brewery: '旭酒造株式会社' });
    queueUpdated();

    const { result, rerender } = renderHook(() =>
      useSpecBackfill([record({ specs: pickSakeSpecs({ brewery: '誤った蔵元' }) })], vi.fn()),
    );

    expect(result.current.rereadTargets).toHaveLength(1);

    await act(async () => {
      await result.current.run({ reread: true });
    });

    rerender();
    expect(result.current.rereadTargets).toHaveLength(0);
  });

  it('読み直しでは、前回読めなかった控えも無視して対象にする', async () => {
    // 1回目: 読めずに控えられる
    queueAnalyzed({ brewery: null });
    const { result, rerender } = renderHook(() => useSpecBackfill([record()], vi.fn()));

    await act(async () => {
      await result.current.run();
    });
    rerender();
    expect(result.current.targets).toHaveLength(0);

    // 読み直しの対象には残っている
    expect(result.current.rereadTargets).toHaveLength(1);
  });
});
