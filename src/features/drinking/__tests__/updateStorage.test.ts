import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { DrinkingFormData } from '@/features/drinking/types';

const { mockGraphqlFn } = vi.hoisted(() => ({
  mockGraphqlFn: vi.fn(async () => ({
    data: { updateDrinkingRecord: { id: 'd1' } },
  })),
}));

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: mockGraphqlFn }),
}));

import { useDrinkingStorage } from '@/features/drinking/hooks/useDrinkingStorage';
import { updateDrinkingRecord } from '@/graphql/mutations';

const formData: DrinkingFormData = {
  sakeName: '白州',
  placeName: 'BAR 花',
  price: '1200',
  drinkingDate: '2026-02-20',
  category: 'WHISKY',
  drinkingMethod: 'ロック',
  rating: 4,
  memo: 'ロックで',
};

describe('useDrinkingStorage.updateDrinking', () => {
  beforeEach(() => {
    mockGraphqlFn.mockClear();
    mockGraphqlFn.mockResolvedValue({ data: { updateDrinkingRecord: { id: 'd1' } } });
  });

  it('更新mutationにidと各フィールドを渡し、成功を返す', async () => {
    const { result } = renderHook(() => useDrinkingStorage());

    await act(async () => {
      const res = await result.current.updateDrinking('d1', formData);
      expect(res.success).toBe(true);
    });

    expect(mockGraphqlFn).toHaveBeenCalledTimes(1);
    const callArgs = mockGraphqlFn.mock.calls[0][0] as {
      query: string;
      variables: { input: Record<string, unknown> };
    };
    expect(callArgs.query).toBe(updateDrinkingRecord);
    const input = callArgs.variables.input;
    expect(input.id).toBe('d1');
    expect(input.sakeName).toBe('白州');
    expect(input.placeName).toBe('BAR 花');
    expect(input.price).toBe(1200);
    expect(input.drinkingDate).toBe('2026-02-20');
    expect(input.category).toBe('WHISKY');
    expect(input.drinkingMethod).toBe('ロック');
    expect(input.rating).toBe(4);
    expect(input.memo).toBe('ロックで');
    expect('imageKey' in input).toBe(false);
    expect('imageKeys' in input).toBe(false);
  });

  it('価格が空文字ならnullを渡す', async () => {
    const { result } = renderHook(() => useDrinkingStorage());

    await act(async () => {
      await result.current.updateDrinking('d1', { ...formData, price: '' });
    });

    const callArgs = mockGraphqlFn.mock.calls[0][0] as {
      variables: { input: Record<string, unknown> };
    };
    expect(callArgs.variables.input.price).toBeNull();
  });

  it('GraphQLエラー時は失敗を返す', async () => {
    mockGraphqlFn.mockResolvedValueOnce({ errors: [{ message: 'boom' }] });
    const { result } = renderHook(() => useDrinkingStorage());

    await act(async () => {
      const res = await result.current.updateDrinking('d1', formData);
      expect(res.success).toBe(false);
      expect(res.error).toBeTruthy();
    });
  });
});
