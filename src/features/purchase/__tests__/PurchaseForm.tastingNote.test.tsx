/**
 * 登録ボタンを押したときに備考へテイスティングノートが入ることを見る。
 *
 * 画像を選んだ時点ではなく登録の直前に走ること（銘柄名を手で直しても
 * 直したあとの名前で書かれること）が要件なので、submit 経由で確かめる。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { PurchaseFormData, SakeCategory } from '@/features/purchase/types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockSavePurchase = vi.fn(async () => ({ success: true }));
vi.mock('@/features/purchase/hooks/usePurchaseStorage', () => ({
  usePurchaseStorage: () => ({
    savePurchase: mockSavePurchase,
    updatePurchase: vi.fn(async () => ({ success: true })),
    isSaving: false,
  }),
}));

vi.mock('@/features/image/hooks/useImageUpload', () => ({
  useImageUpload: () => ({
    imageFile: null,
    imageFiles: [],
    isCompressing: false,
    isUploading: false,
    error: null,
    warning: null,
    handleImageSelect: vi.fn(),
    uploadImages: vi.fn(async () => []),
    clearImage: vi.fn(),
    removeImage: vi.fn(),
    preUploadImages: vi.fn(async () => []),
    imageKey: null,
    imageKeys: [],
  }),
}));

const mockRequestTastingNote = vi.fn();
vi.mock('@/features/tasting/lib/requestTastingNote', () => ({
  requestTastingNote: (...args: unknown[]) => mockRequestTastingNote(...args),
}));

import { PurchaseForm } from '@/features/purchase/components/PurchaseForm';

/**
 * 必須項目を埋めたフォームを出す。
 *
 * カテゴリの選択はポータルを開く Select なので、初期値として渡して切り替える
 * （このテストで見たいのは選択操作ではなく、登録時に何が保存されるか）
 */
function renderForm(sakeName: string, category: SakeCategory, memo = '') {
  const initialData: PurchaseFormData = {
    sakeName,
    storeName: '酒のやまや',
    price: '5000',
    quantity: '1',
    purchaseDate: '2026-08-22',
    category,
    memo,
  };
  render(<PurchaseForm initialData={initialData} />);
}

/** 保存に渡ったフォーム内容 */
function savedData() {
  return mockSavePurchase.mock.calls[0][0] as unknown as PurchaseFormData;
}

describe('PurchaseForm のテイスティングノート追記', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSavePurchase.mockResolvedValue({ success: true });
    mockRequestTastingNote.mockResolvedValue({
      tastingNote: 'バニラと蜂蜜の香り',
      recommendedServing: 'ストレートで',
    });
  });

  it('ウイスキーの登録では備考にノートと飲み方が入る', async () => {
    renderForm('山崎 12年', 'WHISKY');

    fireEvent.submit(screen.getByTestId('purchase-form'));

    await waitFor(() => expect(mockSavePurchase).toHaveBeenCalled());
    expect(mockRequestTastingNote).toHaveBeenCalledWith('山崎 12年', 'WHISKY');
    expect(savedData().memo).toBe(
      'テイスティングノート: バニラと蜂蜜の香り\nおすすめの飲み方: ストレートで',
    );
  });

  it('日本酒の登録では飲み方を書かない', async () => {
    mockRequestTastingNote.mockResolvedValue({
      tastingNote: '華やかな吟醸香',
      recommendedServing: null,
    });
    renderForm('獺祭 純米大吟醸', 'NIHONSHU');

    fireEvent.submit(screen.getByTestId('purchase-form'));

    await waitFor(() => expect(mockSavePurchase).toHaveBeenCalled());
    expect(savedData().memo).toBe('テイスティングノート: 華やかな吟醸香');
  });

  it('ウイスキー・日本酒以外では生成そのものを呼ばない', async () => {
    renderForm('よなよなエール', 'BEER');

    fireEvent.submit(screen.getByTestId('purchase-form'));

    await waitFor(() => expect(mockSavePurchase).toHaveBeenCalled());
    expect(mockRequestTastingNote).not.toHaveBeenCalled();
    expect(savedData().memo).toBe('');
  });

  // ノートが取れないことを理由に登録を止めない
  it('ノートを起こせなくても登録は通る', async () => {
    mockRequestTastingNote.mockResolvedValue({ tastingNote: null, recommendedServing: null });
    renderForm('聞いたことのない酒', 'WHISKY');

    fireEvent.submit(screen.getByTestId('purchase-form'));

    await waitFor(() => expect(mockSavePurchase).toHaveBeenCalled());
    expect(savedData().memo).toBe('');
  });

  it('手入力の備考は消さずに後ろへ足す', async () => {
    renderForm('白州', 'WHISKY', '父への土産');

    fireEvent.submit(screen.getByTestId('purchase-form'));

    await waitFor(() => expect(mockSavePurchase).toHaveBeenCalled());
    expect(savedData().memo).toBe(
      '父への土産\nテイスティングノート: バニラと蜂蜜の香り\nおすすめの飲み方: ストレートで',
    );
  });

  // 銘柄名を手で直してから登録したときに、直したあとの名前で書かれること
  it('登録直前の銘柄名で生成する', async () => {
    renderForm('山崎', 'WHISKY');

    fireEvent.change(screen.getByTestId('input-sakeName'), { target: { value: '山崎 18年' } });
    fireEvent.submit(screen.getByTestId('purchase-form'));

    await waitFor(() => expect(mockSavePurchase).toHaveBeenCalled());
    expect(mockRequestTastingNote).toHaveBeenCalledWith('山崎 18年', 'WHISKY');
  });
});
