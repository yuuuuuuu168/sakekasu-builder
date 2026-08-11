// 在庫から飲むときの画像引き継ぎ。
//
// 「在庫から飲む」は銘柄・カテゴリ・紐づけ ID だけを引き継いでいて、購入記録に
// 写真があっても飲酒記録の一覧はプレースホルダーになっていた。写真を撮り直して
// いないときは購入記録の写真を複製して引き継ぐ。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockSaveDrinking = vi.fn(async () => ({ success: true }));
vi.mock('@/features/drinking/hooks/useDrinkingStorage', () => ({
  useDrinkingStorage: () => ({
    saveDrinking: (...args: unknown[]) => mockSaveDrinking(...args),
    isSaving: false,
  }),
}));

vi.mock('@/features/purchase/lib/purchaseStatus', () => ({
  markPurchaseAsInProgress: vi.fn(async () => 'opened'),
}));

// 写真を選んでいない状態を作る（在庫の写真を引き継ぐ経路に入る）
vi.mock('@/features/image/hooks/useImageUpload', () => ({
  useImageUpload: () => ({
    imageFile: null,
    imageFiles: [],
    setImageFile: vi.fn(),
    addImageFile: vi.fn(),
    removeImageFile: vi.fn(),
    clearImage: vi.fn(),
    uploadImages: vi.fn(async () => []),
    preUploadImage: vi.fn(),
    preUploadImages: vi.fn(),
    isUploading: false,
    error: null,
  }),
}));

const mockCopyRecordImages = vi.fn();
vi.mock('@/features/image/lib/copyRecordImages', () => ({
  copyRecordImages: (...args: unknown[]) => mockCopyRecordImages(...args),
}));

import { DrinkingForm } from '../components/DrinkingForm';
import type { StockDrinkDraft } from '../types';

const SOURCE_KEYS = [
  'sub/purchase/purchase-002/IMG_3206.jpeg',
  'sub/purchase/purchase-002/IMG_3207.jpeg',
];
const COPIED_KEYS = [
  'sub/drinking/new-id/IMG_3206.jpeg',
  'sub/drinking/new-id/IMG_3207.jpeg',
];

// 飲み方の選択が不要なカテゴリを使って Select 操作を避ける
const draftWithImages: StockDrinkDraft = {
  purchaseRecordId: 'purchase-002',
  sakeName: 'よなよなエール',
  category: 'BEER',
  imageKeys: SOURCE_KEYS,
};

function rateAndSubmit() {
  fireEvent.click(screen.getByTestId('star-3'));
  fireEvent.click(screen.getByTestId('submit-button'));
}

describe('DrinkingForm 在庫の画像引き継ぎ', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveDrinking.mockResolvedValue({ success: true });
    mockCopyRecordImages.mockResolvedValue(COPIED_KEYS);
  });

  it('在庫の写真を複製して、複製後のキーで登録する', async () => {
    render(<DrinkingForm stockDraft={draftWithImages} />);

    rateAndSubmit();

    await waitFor(() => {
      expect(mockSaveDrinking).toHaveBeenCalled();
    });

    // 複製先は飲酒記録の領域。購入記録のキーをそのまま使うと、
    // 片方を削除したときに S3 の実体が消えてもう片方の画像も消える
    expect(mockCopyRecordImages).toHaveBeenCalledWith(SOURCE_KEYS, 'drinking', expect.any(String));

    const [, options] = mockSaveDrinking.mock.calls[0] as [unknown, { imageKey: string | null; imageKeys: string[] }];
    expect(options.imageKeys).toEqual(COPIED_KEYS);
    expect(options.imageKey).toBe(COPIED_KEYS[0]);
  });

  it('在庫に写真が無ければ複製しない', async () => {
    render(<DrinkingForm stockDraft={{ ...draftWithImages, imageKeys: [] }} />);

    rateAndSubmit();

    await waitFor(() => {
      expect(mockSaveDrinking).toHaveBeenCalled();
    });

    expect(mockCopyRecordImages).not.toHaveBeenCalled();
    const [, options] = mockSaveDrinking.mock.calls[0] as [unknown, { imageKeys: string[] }];
    expect(options.imageKeys).toEqual([]);
  });

  // 記録そのものは残したい。画像は付加情報なので、複製に失敗しても登録は通す
  it('複製に失敗しても、画像なしで登録は完了する', async () => {
    mockCopyRecordImages.mockRejectedValue(new Error('network'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<DrinkingForm stockDraft={draftWithImages} />);

    rateAndSubmit();

    await waitFor(() => {
      expect(mockSaveDrinking).toHaveBeenCalled();
    });

    const [, options] = mockSaveDrinking.mock.calls[0] as [unknown, { imageKey: string | null; imageKeys: string[] }];
    expect(options.imageKeys).toEqual([]);
    expect(options.imageKey).toBeNull();
  });
});
