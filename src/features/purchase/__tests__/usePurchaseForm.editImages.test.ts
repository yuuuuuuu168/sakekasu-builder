// 編集画面からの画像追加（Issue #142）。
//
// 追加であって差し替えではない。既存のキーを消したり、代表画像が勝手に
// 入れ替わったりしないことをここで固定する。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { PurchaseFormData } from '@/features/purchase/types';

const mockUpdatePurchase = vi.hoisted(() => vi.fn());
const mockSavePurchase = vi.hoisted(() => vi.fn());
const mockUploadImages = vi.hoisted(() => vi.fn());
const mockClearImage = vi.hoisted(() => vi.fn());
const imageState = vi.hoisted(() => ({ files: [] as File[] }));

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
    imageFiles: imageState.files,
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
    uploadImages: mockUploadImages,
    preUploadImage: vi.fn(),
    preUploadImages: vi.fn(),
    clearImage: mockClearImage,
  }),
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

const EXISTING = ['sub-1/purchase/p1/first.jpg'];

/** 更新時に渡された画像オプション */
function updateOptions(): { imageKey?: string | null; imageKeys?: string[] } | undefined {
  return mockUpdatePurchase.mock.calls[0]?.[2];
}

describe('usePurchaseForm の編集モードでの画像追加', () => {
  beforeEach(() => {
    mockUpdatePurchase.mockReset();
    mockUpdatePurchase.mockResolvedValue({ success: true });
    mockUploadImages.mockReset();
    mockClearImage.mockReset();
    imageState.files = [];
  });

  it('画像を足していない更新では画像オプションを渡さない', async () => {
    const { result } = renderHook(() =>
      usePurchaseForm({
        recordId: 'p1',
        initialData: formData,
        existingImageKey: EXISTING[0],
        existingImageKeys: EXISTING,
      }),
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(mockUploadImages).not.toHaveBeenCalled();
    // 既存のキーを維持するため、画像の項目自体を送らない
    expect(updateOptions()).toBeUndefined();
  });

  it('追加した画像を既存キーの後ろに足す', async () => {
    imageState.files = [new File(['x'], 'added.jpg', { type: 'image/jpeg' })];
    mockUploadImages.mockResolvedValue(['sub-1/purchase/p1/added.jpg']);

    const { result } = renderHook(() =>
      usePurchaseForm({
        recordId: 'p1',
        initialData: formData,
        existingImageKey: EXISTING[0],
        existingImageKeys: EXISTING,
      }),
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    // 記録の ID 配下へ入れる（一時領域からの複製は useImageUpload 側で行う）
    expect(mockUploadImages).toHaveBeenCalledWith('purchase', 'p1');
    expect(updateOptions()?.imageKeys).toEqual([
      'sub-1/purchase/p1/first.jpg',
      'sub-1/purchase/p1/added.jpg',
    ]);
    // 代表画像は既存のまま。追加で一覧のサムネイルが入れ替わらないようにする
    expect(updateOptions()?.imageKey).toBe('sub-1/purchase/p1/first.jpg');
  });

  it('画像が無かった記録では追加した1枚目を代表画像にする', async () => {
    imageState.files = [new File(['x'], 'added.jpg', { type: 'image/jpeg' })];
    mockUploadImages.mockResolvedValue(['sub-1/purchase/p1/added.jpg']);

    const { result } = renderHook(() =>
      usePurchaseForm({
        recordId: 'p1',
        initialData: formData,
        existingImageKey: null,
        existingImageKeys: [],
      }),
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(updateOptions()?.imageKey).toBe('sub-1/purchase/p1/added.jpg');
    expect(updateOptions()?.imageKeys).toEqual(['sub-1/purchase/p1/added.jpg']);
  });

  it('アップロードに失敗したら更新しない（入力を保持する）', async () => {
    imageState.files = [new File(['x'], 'added.jpg', { type: 'image/jpeg' })];
    mockUploadImages.mockResolvedValue([]);

    const { result } = renderHook(() =>
      usePurchaseForm({
        recordId: 'p1',
        initialData: formData,
        existingImageKeys: EXISTING,
      }),
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    // 画像だけ失敗した状態で記録を更新すると、キーの整合が崩れる
    expect(mockUpdatePurchase).not.toHaveBeenCalled();
  });

  it('更新が成功したら選択中のファイルを片付ける（二重追加の防止）', async () => {
    imageState.files = [new File(['x'], 'added.jpg', { type: 'image/jpeg' })];
    mockUploadImages.mockResolvedValue(['sub-1/purchase/p1/added.jpg']);

    const { result } = renderHook(() =>
      usePurchaseForm({
        recordId: 'p1',
        initialData: formData,
        existingImageKeys: EXISTING,
      }),
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(mockClearImage).toHaveBeenCalled();
  });
});
