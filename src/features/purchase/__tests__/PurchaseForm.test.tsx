import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { format } from 'date-fns';

// sonner の toast をモック
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// usePurchaseStorage をモック
const mockSavePurchase = vi.fn(async () => ({ success: true }));
vi.mock('@/features/purchase/hooks/usePurchaseStorage', () => ({
  usePurchaseStorage: () => ({
    savePurchase: mockSavePurchase,
    isSaving: false,
  }),
}));

// useImageUpload をモック
const mockHandleImageSelect = vi.fn();
const mockUploadImage = vi.fn(async () => null);
const mockClearImage = vi.fn();
vi.mock('@/features/image/hooks/useImageUpload', () => ({
  useImageUpload: () => ({
    imageFile: null,
    imageFiles: [],
    setImageFile: vi.fn(),
    isCompressing: false,
    isUploading: false,
    error: null,
    handleImageSelect: mockHandleImageSelect,
    uploadImage: mockUploadImage,
    uploadImages: vi.fn(async () => []),
    clearImage: mockClearImage,
    removeImage: vi.fn(),
    preUploadImage: vi.fn(async () => null),
    preUploadImages: vi.fn(async () => []),
    imageKey: null,
    imageKeys: [],
  }),
}));

import { PurchaseForm } from '@/features/purchase/components/PurchaseForm';

describe('PurchaseForm ユニットテスト', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSavePurchase.mockResolvedValue({ success: true });
  });

  describe('フォーム初期表示', () => {
    it('全フィールドが存在する', () => {
      render(<PurchaseForm />);

      expect(screen.getByTestId('input-sakeName')).toBeInTheDocument();
      expect(screen.getByTestId('input-storeName')).toBeInTheDocument();
      expect(screen.getByTestId('input-price')).toBeInTheDocument();
      expect(screen.getByTestId('input-purchaseDate')).toBeInTheDocument();
      expect(screen.getByTestId('input-category')).toBeInTheDocument();
      expect(screen.getByTestId('input-memo')).toBeInTheDocument();
      expect(screen.getByTestId('submit-button')).toBeInTheDocument();
    });

    it('購入日の初期値が本日の日付で表示される', () => {
      render(<PurchaseForm />);

      const today = format(new Date(), 'yyyy年MM月dd日');
      const dateButton = screen.getByTestId('input-purchaseDate');
      expect(dateButton).toHaveTextContent(today);
    });

    it('登録ボタンのテキストが「🍶 登録する」である', () => {
      render(<PurchaseForm />);

      const submitButton = screen.getByTestId('submit-button');
      expect(submitButton).toHaveTextContent('🍶 登録する');
    });
  });

  describe('保存成功時', () => {
    it('成功メッセージが toast.success で表示される', async () => {
      mockSavePurchase.mockResolvedValue({ success: true });
      render(<PurchaseForm />);

      // 必須フィールドに有効な値を入力
      fireEvent.change(screen.getByTestId('input-sakeName'), {
        target: { value: '獺祭' },
      });
      fireEvent.change(screen.getByTestId('input-storeName'), {
        target: { value: '酒のやまや' },
      });
      fireEvent.change(screen.getByTestId('input-price'), {
        target: { value: '3000' },
      });

      // フォーム送信
      fireEvent.click(screen.getByTestId('submit-button'));

      await waitFor(() => {
        expect(mockToastSuccess).toHaveBeenCalledWith('登録が完了しました');
      });
    });
  });

  describe('保存失敗時', () => {
    it('エラーメッセージが toast.error で表示される', async () => {
      mockSavePurchase.mockResolvedValue({
        success: false,
        error: '登録に失敗しました。もう一度お試しください',
      });
      render(<PurchaseForm />);

      // 必須フィールドに有効な値を入力
      fireEvent.change(screen.getByTestId('input-sakeName'), {
        target: { value: '獺祭' },
      });
      fireEvent.change(screen.getByTestId('input-storeName'), {
        target: { value: '酒のやまや' },
      });
      fireEvent.change(screen.getByTestId('input-price'), {
        target: { value: '3000' },
      });

      // フォーム送信
      fireEvent.click(screen.getByTestId('submit-button'));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          '登録に失敗しました。もう一度お試しください',
        );
      });
    });
  });
});
