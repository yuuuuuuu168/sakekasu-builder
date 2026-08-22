/**
 * 登録時の追記フックのテスト。
 *
 * 見るのは3つ。対象カテゴリでだけ呼ぶこと、記載済みなら呼ばないこと、
 * 失敗しても備考を壊さないこと（登録そのものを止めないため）。
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTastingNote } from '../hooks/useTastingNote';

const { mockGraphql } = vi.hoisted(() => ({ mockGraphql: vi.fn() }));

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: mockGraphql }),
}));

function resolveWith(tastingNote: string | null, recommendedServing: string | null = null) {
  mockGraphql.mockResolvedValueOnce({
    data: { generateTastingNote: { tastingNote, recommendedServing } },
  });
}

describe('useTastingNote', () => {
  beforeEach(() => {
    mockGraphql.mockReset();
  });

  it('ウイスキーではノートと飲み方を備考へ足す', async () => {
    resolveWith('バニラと蜂蜜の香り', 'ストレートで');
    const { result } = renderHook(() => useTastingNote());

    let memo = '';
    await act(async () => {
      memo = await result.current.fillMemo('', '山崎 12年', 'WHISKY');
    });

    expect(mockGraphql).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { sakeName: '山崎 12年', category: 'WHISKY' } }),
    );
    expect(memo).toBe('テイスティングノート: バニラと蜂蜜の香り\nおすすめの飲み方: ストレートで');
  });

  it('日本酒ではノートだけを足す', async () => {
    resolveWith('華やかな吟醸香', null);
    const { result } = renderHook(() => useTastingNote());

    let memo = '';
    await act(async () => {
      memo = await result.current.fillMemo('', '獺祭 純米大吟醸', 'NIHONSHU');
    });

    expect(memo).toBe('テイスティングノート: 華やかな吟醸香');
  });

  it('ウイスキー・日本酒以外では呼び出さない', async () => {
    const { result } = renderHook(() => useTastingNote());

    let memo = '';
    await act(async () => {
      memo = await result.current.fillMemo('よく冷やして', 'よなよなエール', 'BEER');
    });

    expect(mockGraphql).not.toHaveBeenCalled();
    expect(memo).toBe('よく冷やして');
  });

  it('すでにノートがある備考では呼び出さない', async () => {
    const { result } = renderHook(() => useTastingNote());
    const existing = 'テイスティングノート: 元の内容';

    let memo = '';
    await act(async () => {
      memo = await result.current.fillMemo(existing, '山崎 12年', 'WHISKY');
    });

    expect(mockGraphql).not.toHaveBeenCalled();
    expect(memo).toBe(existing);
  });

  it('銘柄名が空なら呼び出さない', async () => {
    const { result } = renderHook(() => useTastingNote());

    await act(async () => {
      await result.current.fillMemo('', '   ', 'WHISKY');
    });

    expect(mockGraphql).not.toHaveBeenCalled();
  });

  // ノートが取れないことを理由に登録を止めたくない
  it('生成に失敗しても備考をそのまま返す', async () => {
    mockGraphql.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useTastingNote());

    let memo = '';
    await act(async () => {
      memo = await result.current.fillMemo('店で試飲', '山崎 12年', 'WHISKY');
    });

    expect(memo).toBe('店で試飲');
    expect(result.current.isGenerating).toBe(false);
  });

  it('知らない銘柄（両方 null）でも備考を変えない', async () => {
    resolveWith(null, null);
    const { result } = renderHook(() => useTastingNote());

    let memo = '';
    await act(async () => {
      memo = await result.current.fillMemo('', '聞いたことのない酒', 'NIHONSHU');
    });

    expect(memo).toBe('');
  });
});
