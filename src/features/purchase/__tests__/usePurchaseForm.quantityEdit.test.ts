// 本数を書き換えたときの残本数（Issue #159）。
//
// 残本数は「まだ飲みきっていない本数」なので、飲んだ本数を保ったまま
// 新しい購入本数に合わせる。本数を触っていない更新では送らない。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { PurchaseFormData } from '@/features/purchase/types';

const mockUpdatePurchase = vi.hoisted(() => vi.fn());
const mockSavePurchase = vi.hoisted(() => vi.fn());

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
    updatePurchase: mockUpdatePurchase,
    isSaving: false,
  }),
}));

vi.mock('@/features/image/hooks/useImageUpload', () => ({
  useImageUpload: () => ({
    imageFile: null,
    imageFiles: [],
    setImageFile: vi.fn(),
    isCompressing: false,
    isUploading: false,
    error: null,
    warning: null,
    imageKey: null,
    imageKeys: [],
    handleImageSelect: vi.fn(),
    removeImage: vi.fn(),
    uploadImage: vi.fn(),
    uploadImages: vi.fn(),
    preUploadImage: vi.fn(),
    preUploadImages: vi.fn(),
    clearImage: vi.fn(),
  }),
}));

import { usePurchaseForm } from '@/features/purchase/hooks/usePurchaseForm';

function formData(quantity: string): PurchaseFormData {
  return {
    sakeName: '獺祭',
    storeName: 'やまや',
    price: '3300',
    quantity,
    purchaseDate: '2026-08-11',
    category: 'NIHONSHU',
    memo: '',
  };
}

/** 更新時に渡されたオプション */
function updateOptions(): { remainingQuantity?: number } | undefined {
  return mockUpdatePurchase.mock.calls[0]?.[2];
}

/** 本数 3・残り 2（1本飲んだ）の記録を編集する */
async function submitWithQuantity(quantity: string) {
  const { result } = renderHook(() =>
    usePurchaseForm({
      recordId: 'p1',
      initialData: formData(quantity),
      existingBottles: { quantity: 3, remainingQuantity: 2, drinkingStatus: 'NOT_STARTED' },
    }),
  );

  await act(async () => {
    await result.current.handleSubmit();
  });
}

describe('usePurchaseForm の本数編集', () => {
  beforeEach(() => {
    mockUpdatePurchase.mockReset();
    mockUpdatePurchase.mockResolvedValue({ success: true });
  });

  it('本数を増やすと飲んだぶんを差し引いた残本数になる', async () => {
    await submitWithQuantity('5');

    expect(updateOptions()?.remainingQuantity).toBe(4);
  });

  it('飲んだ本数まで減らすと残り0本になる', async () => {
    await submitWithQuantity('1');

    expect(updateOptions()?.remainingQuantity).toBe(0);
  });

  it('本数を触っていない更新では残本数を送らない', async () => {
    await submitWithQuantity('3');

    expect(updateOptions()).toBeUndefined();
  });
});
