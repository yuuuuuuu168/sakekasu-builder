import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { PurchaseFormData } from '@/features/purchase/types';

const { mockGraphqlFn } = vi.hoisted(() => ({
  mockGraphqlFn: vi.fn(async () => ({
    data: { updatePurchaseRecord: { id: 'p1' } },
  })),
}));

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: mockGraphqlFn }),
}));

import { usePurchaseStorage } from '@/features/purchase/hooks/usePurchaseStorage';
import { updatePurchaseRecord } from '@/graphql/mutations';

const formData: PurchaseFormData = {
  sakeName: '獺祭',
  storeName: 'やまや',
  price: '3300',
  purchaseDate: '2026-01-15',
  category: 'NIHONSHU',
  memo: 'メモ',
};

describe('usePurchaseStorage.updatePurchase', () => {
  beforeEach(() => {
    mockGraphqlFn.mockClear();
    mockGraphqlFn.mockResolvedValue({ data: { updatePurchaseRecord: { id: 'p1' } } });
  });

  it('更新mutationにidと各フィールドを渡し、成功を返す', async () => {
    const { result } = renderHook(() => usePurchaseStorage());

    await act(async () => {
      const res = await result.current.updatePurchase('p1', formData);
      expect(res.success).toBe(true);
    });

    expect(mockGraphqlFn).toHaveBeenCalledTimes(1);
    const callArgs = mockGraphqlFn.mock.calls[0][0] as {
      query: string;
      variables: { input: Record<string, unknown> };
    };
    expect(callArgs.query).toBe(updatePurchaseRecord);
    const input = callArgs.variables.input;
    expect(input.id).toBe('p1');
    expect(input.sakeName).toBe('獺祭');
    expect(input.storeName).toBe('やまや');
    expect(input.price).toBe(3300);
    expect(input.purchaseDate).toBe('2026-01-15');
    expect(input.category).toBe('NIHONSHU');
    expect(input.memo).toBe('メモ');
    // 画像フィールドは更新対象外
    expect('imageKey' in input).toBe(false);
    expect('imageKeys' in input).toBe(false);
  });

  it('GraphQLエラー時は失敗を返す', async () => {
    mockGraphqlFn.mockResolvedValueOnce({ errors: [{ message: 'boom' }] });
    const { result } = renderHook(() => usePurchaseStorage());

    await act(async () => {
      const res = await result.current.updatePurchase('p1', formData);
      expect(res.success).toBe(false);
      expect(res.error).toBeTruthy();
    });
  });
});
