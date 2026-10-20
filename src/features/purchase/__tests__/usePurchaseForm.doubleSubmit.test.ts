// 登録ボタンの連打で購入記録が二重に作られないこと。
//
// isSaving は保存 mutation が始まってから立つので、その手前の
// テイスティングノート生成や画像アップロードの間に 2 回目の送信が通ってしまう。
// 飲酒フォーム（useDrinkingForm）と同じく、送信全体を ref で覆う

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { PurchaseFormData } from '@/features/purchase/types';

const mockSavePurchase = vi.hoisted(() => vi.fn());
const mockFillMemo = vi.hoisted(() => vi.fn());

vi.mock('@/features/purchase/hooks/useFormValidation', () => ({
  useFormValidation: () => ({
    errors: {},
    validateField: vi.fn(),
    validateAll: vi.fn(),
    isValid: () => true,
    clearErrors: vi.fn(),
  }),
}));

vi.mock('@/features/purchase/hooks/usePurchaseStorage', () => ({
  usePurchaseStorage: () => ({
    savePurchase: mockSavePurchase,
    updatePurchase: vi.fn(),
    isSaving: false,
  }),
}));

vi.mock('@/features/tasting/hooks/useTastingNote', () => ({
  useTastingNote: () => ({ fillMemo: mockFillMemo, isGenerating: false }),
}));

import { usePurchaseForm } from '@/features/purchase/hooks/usePurchaseForm';

const formData: PurchaseFormData = {
  sakeName: '獺祭',
  storeName: 'やまや',
  price: '3300',
  quantity: '1',
  purchaseDate: '2026-08-11',
  category: 'NIHONSHU',
  memo: '',
};

describe('usePurchaseForm の連打', () => {
  beforeEach(() => {
    mockSavePurchase.mockReset();
    mockSavePurchase.mockResolvedValue({ success: true });
    mockFillMemo.mockReset();
  });

  it('テイスティングノートの生成中に再送信しても登録は1回しか走らない', async () => {
    const pending: ((memo: string) => void)[] = [];
    mockFillMemo.mockImplementation(
      () => new Promise<string>((resolve) => { pending.push(resolve); }),
    );

    const { result } = renderHook(() =>
      usePurchaseForm({ initialData: formData }),
    );

    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.handleSubmit();
    });
    act(() => {
      second = result.current.handleSubmit();
    });

    await act(async () => {
      pending.forEach((resolve) => resolve(''));
      await Promise.all([first, second]);
    });

    expect(mockFillMemo).toHaveBeenCalledTimes(1);
    expect(mockSavePurchase).toHaveBeenCalledTimes(1);
  });

  it('送信が終われば次の送信を受け付ける', async () => {
    mockFillMemo.mockResolvedValue('');
    const { result } = renderHook(() =>
      usePurchaseForm({ initialData: formData }),
    );

    await act(async () => {
      await result.current.handleSubmit();
    });
    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(mockSavePurchase).toHaveBeenCalledTimes(2);
  });

  it('保存が失敗しても次の送信を受け付ける', async () => {
    mockFillMemo.mockResolvedValue('');
    mockSavePurchase.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() =>
      usePurchaseForm({ initialData: formData }),
    );

    await act(async () => {
      await result.current.handleSubmit().catch(() => {});
    });
    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(mockSavePurchase).toHaveBeenCalledTimes(2);
  });
});
