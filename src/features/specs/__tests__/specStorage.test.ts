// Feature: 詳細スペック項目の記録対応（Issue #87）: mutation へ載せる値

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { PurchaseFormData } from '@/features/purchase/types';
import type { DrinkingFormData } from '@/features/drinking/types';

const { mockGraphqlFn } = vi.hoisted(() => ({
  mockGraphqlFn: vi.fn(async () => ({ data: {} })),
}));

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: mockGraphqlFn }),
}));

import { usePurchaseStorage } from '@/features/purchase/hooks/usePurchaseStorage';
import { useDrinkingStorage } from '@/features/drinking/hooks/useDrinkingStorage';
import { createEmptySpecFormData } from '../lib/sakeSpecs';

const purchaseData: PurchaseFormData = {
  sakeName: '獺祭',
  storeName: 'やまや',
  price: '3300',
  quantity: '1',
  purchaseDate: '2026-01-15',
  category: 'NIHONSHU',
  memo: '',
};

const drinkingData: DrinkingFormData = {
  sakeName: '獺祭',
  placeName: '自宅',
  price: '',
  drinkingDate: '2026-01-15',
  category: 'NIHONSHU',
  drinkingMethod: '冷酒',
  rating: 5,
  memo: '',
};

const filledSpecs = {
  ...createEmptySpecFormData(),
  brewery: '旭酒造株式会社',
  ricePolishingRatio: '23',
};

/** 直近の呼び出しで送られた input */
function lastInput(): Record<string, unknown> {
  const call = mockGraphqlFn.mock.calls[mockGraphqlFn.mock.calls.length - 1][0] as {
    variables: { input: Record<string, unknown> };
  };
  return call.variables.input;
}

describe('詳細スペックの保存', () => {
  beforeEach(() => {
    mockGraphqlFn.mockClear();
    mockGraphqlFn.mockResolvedValue({ data: {} });
  });

  it('購入記録の作成では値のある項目だけを送る', async () => {
    const { result } = renderHook(() => usePurchaseStorage());

    await act(async () => {
      await result.current.savePurchase(purchaseData, { specs: filledSpecs });
    });

    const input = lastInput();
    expect(input.brewery).toBe('旭酒造株式会社');
    expect(input.ricePolishingRatio).toBe(23);
    // 未入力の項目は載せない（使わない記録に空の属性を並べない）
    expect('yeast' in input).toBe(false);
  });

  it('購入記録の更新では空欄も null として送る（消せるように）', async () => {
    const { result } = renderHook(() => usePurchaseStorage());

    await act(async () => {
      await result.current.updatePurchase('p1', purchaseData, { specs: filledSpecs });
    });

    const input = lastInput();
    expect(input.brewery).toBe('旭酒造株式会社');
    expect(input.yeast).toBeNull();
  });

  it('詳細スペックを渡さない保存では項目自体を送らない', async () => {
    const { result } = renderHook(() => usePurchaseStorage());

    await act(async () => {
      await result.current.updatePurchase('p1', purchaseData);
    });

    expect('brewery' in lastInput()).toBe(false);
  });

  it('飲酒記録でも同じように保存できる', async () => {
    const { result } = renderHook(() => useDrinkingStorage());

    await act(async () => {
      await result.current.saveDrinking(drinkingData, { specs: filledSpecs });
    });
    expect(lastInput().brewery).toBe('旭酒造株式会社');

    await act(async () => {
      await result.current.updateDrinking('d1', drinkingData, { specs: filledSpecs });
    });
    expect(lastInput().yeast).toBeNull();
  });
});
