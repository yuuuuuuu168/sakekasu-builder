import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { mockGraphqlFn } = vi.hoisted(() => ({
  mockGraphqlFn: vi.fn(async () => ({ data: { updatePurchaseRecord: { id: 'p-1' } } })),
}));

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: mockGraphqlFn }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { useUpdateDrinkingStatus } from '../hooks/useUpdateDrinkingStatus';
import { updatePurchaseRecord } from '@/graphql/mutations';
import type { UnifiedRecord } from '../types';

function purchase(overrides: Partial<UnifiedRecord> = {}): UnifiedRecord {
  return {
    id: 'p-1',
    type: 'purchase',
    sakeName: '獺祭',
    price: 3000,
    date: '2026-01-10',
    category: 'NIHONSHU',
    storeName: '酒屋',
    quantity: 3,
    remainingQuantity: 3,
    drinkingStatus: 'IN_PROGRESS',
    openedAt: '2026-01-11T00:00:00.000Z',
    imageKeys: [],
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
    ...overrides,
  };
}

/** 送信された mutation の input を取り出す */
function lastInput(): Record<string, unknown> {
  const call = mockGraphqlFn.mock.calls.at(-1)?.[0] as {
    query: string;
    variables: { input: Record<string, unknown> };
  };
  expect(call.query).toBe(updatePurchaseRecord);
  return call.variables.input;
}

describe('useUpdateDrinkingStatus', () => {
  beforeEach(() => {
    mockGraphqlFn.mockClear();
    mockGraphqlFn.mockResolvedValue({ data: { updatePurchaseRecord: { id: 'p-1' } } });
  });

  it('3本のうち1本を飲みきると残り2本の未開封に戻る', async () => {
    const patchRecord = vi.fn();
    const { result } = renderHook(() => useUpdateDrinkingStatus(patchRecord));

    await act(async () => {
      await result.current.updateStatus(purchase(), 'FINISHED');
    });

    expect(lastInput()).toMatchObject({
      id: 'p-1',
      drinkingStatus: 'NOT_STARTED',
      remainingQuantity: 2,
      openedAt: null,
    });
    expect(patchRecord).toHaveBeenCalledWith('p-1', {
      drinkingStatus: 'NOT_STARTED',
      remainingQuantity: 2,
      openedAt: null,
    });
  });

  it('本数を指定するとそのぶんだけ減る', async () => {
    const { result } = renderHook(() => useUpdateDrinkingStatus(vi.fn()));

    await act(async () => {
      await result.current.updateStatus(purchase(), 'FINISHED', 2);
    });

    expect(lastInput()).toMatchObject({ drinkingStatus: 'NOT_STARTED', remainingQuantity: 1 });
  });

  it('最後の1本を飲みきると記録が飲みきりになり、開封日時は残る', async () => {
    const { result } = renderHook(() => useUpdateDrinkingStatus(vi.fn()));

    await act(async () => {
      await result.current.updateStatus(purchase({ remainingQuantity: 1 }), 'FINISHED');
    });

    const input = lastInput();
    expect(input).toMatchObject({ drinkingStatus: 'FINISHED', remainingQuantity: 0 });
    expect('openedAt' in input).toBe(false);
  });

  it('失敗したら操作前の値へ戻す', async () => {
    mockGraphqlFn.mockRejectedValueOnce(new Error('network'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const patchRecord = vi.fn();
    const { result } = renderHook(() => useUpdateDrinkingStatus(patchRecord));

    await act(async () => {
      await result.current.updateStatus(purchase(), 'FINISHED');
    });

    expect(patchRecord).toHaveBeenLastCalledWith('p-1', {
      drinkingStatus: 'IN_PROGRESS',
      remainingQuantity: 3,
      openedAt: '2026-01-11T00:00:00.000Z',
    });
    consoleError.mockRestore();
  });
});
