import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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

// useImageUpload をモック（画像あり + 事前アップロード対応）
const mockPreUploadImage = vi.fn(async () => 'users/test-sub/purchase/test-id/test.jpg');
const mockPreUploadImages = vi.fn(async () => ['users/test-sub/purchase/test-id/test.jpg']);
vi.mock('@/features/image/hooks/useImageUpload', () => ({
  useImageUpload: () => ({
    imageFile: new File(['test'], 'test.jpg', { type: 'image/jpeg' }),
    setImageFile: vi.fn(),
    isCompressing: false,
    isUploading: false,
    error: null,
    imageKey: 'users/test-sub/purchase/test-id/test.jpg',
    imageKeys: ['users/test-sub/purchase/test-id/test.jpg'],
    handleImageSelect: vi.fn(),
    uploadImage: vi.fn(async () => 'users/test-sub/purchase/test-id/test.jpg'),
    preUploadImage: mockPreUploadImage,
    preUploadImages: mockPreUploadImages,
    clearImage: vi.fn(),
  }),
}));

// useOcrAnalysis をモック
const mockAnalyzeImage = vi.fn();
const mockResetOcr = vi.fn();
vi.mock('@/features/image/hooks/useOcrAnalysis', () => ({
  useOcrAnalysis: () => ({
    analyzeImage: mockAnalyzeImage,
    isAnalyzing: false,
    ocrResult: null,
    ocrError: null,
    resetOcr: mockResetOcr,
  }),
}));

import { PurchaseForm } from '@/features/purchase/components/PurchaseForm';

describe('PurchaseForm OCR 統合テスト', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSavePurchase.mockResolvedValue({ success: true });
    global.URL.createObjectURL = vi.fn(() => 'blob:test-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('OCR ボタンクリックで analyzeImage が呼ばれ、結果が sakeName に反映される', async () => {
    mockAnalyzeImage.mockResolvedValue({
      sakeName: '獺祭',
      confidence: 0.95,
      rawTexts: ['獺祭'],
    });

    render(<PurchaseForm />);

    const ocrButton = screen.getByTestId('ocr-trigger-button');
    fireEvent.click(ocrButton);

    await waitFor(() => {
      expect(mockAnalyzeImage).toHaveBeenCalled();
    });

    await waitFor(() => {
      const sakeNameInput = screen.getByTestId('input-sakeName') as HTMLInputElement;
      expect(sakeNameInput.value).toBe('獺祭');
    });
  });

  it('既存の sakeName が OCR 結果で上書きされる', async () => {
    mockAnalyzeImage.mockResolvedValue({
      sakeName: '獺祭',
      confidence: 0.95,
      rawTexts: ['獺祭'],
    });

    render(<PurchaseForm />);

    // 先に sakeName に値を入力
    const sakeNameInput = screen.getByTestId('input-sakeName') as HTMLInputElement;
    fireEvent.change(sakeNameInput, { target: { value: '久保田' } });
    expect(sakeNameInput.value).toBe('久保田');

    // OCR トリガーボタンをクリック
    const ocrButton = screen.getByTestId('ocr-trigger-button');
    fireEvent.click(ocrButton);

    // OCR 結果で上書きされることを確認
    await waitFor(() => {
      expect(sakeNameInput.value).toBe('獺祭');
    });
  });

  it('OCR がカテゴリ・産地・度数を返した場合、カテゴリ選択とメモに反映される', async () => {
    mockAnalyzeImage.mockResolvedValue({
      sakeName: '獺祭',
      category: 'NIHONSHU',
      region: '山口県',
      alcoholPercentage: 16,
      confidence: 0.9,
      rawTexts: ['{"sakeName":"獺祭"}'],
    });

    render(<PurchaseForm />);

    const ocrButton = screen.getByTestId('ocr-trigger-button');
    fireEvent.click(ocrButton);

    await waitFor(() => {
      const sakeNameInput = screen.getByTestId('input-sakeName') as HTMLInputElement;
      expect(sakeNameInput.value).toBe('獺祭');
    });

    // カテゴリ選択に日本酒が反映される
    expect(screen.getByTestId('input-category').textContent).toContain('日本酒');

    // メモ欄に産地・度数が追記される
    const memoInput = screen.getByTestId('input-memo') as HTMLTextAreaElement;
    expect(memoInput.value).toBe('産地: 山口県 / アルコール度数: 16%');
  });

  it('OCR がカテゴリ・産地・度数を返さない場合、カテゴリとメモは変更されない', async () => {
    mockAnalyzeImage.mockResolvedValue({
      sakeName: '獺祭',
      category: null,
      region: null,
      alcoholPercentage: null,
      confidence: 0.9,
      rawTexts: ['{"sakeName":"獺祭"}'],
    });

    render(<PurchaseForm />);

    const memoInput = screen.getByTestId('input-memo') as HTMLTextAreaElement;
    fireEvent.change(memoInput, { target: { value: '既存メモ' } });

    const ocrButton = screen.getByTestId('ocr-trigger-button');
    fireEvent.click(ocrButton);

    await waitFor(() => {
      const sakeNameInput = screen.getByTestId('input-sakeName') as HTMLInputElement;
      expect(sakeNameInput.value).toBe('獺祭');
    });

    expect(memoInput.value).toBe('既存メモ');
  });

  it('OCR 結果反映後も sakeName フィールドが編集可能である', async () => {
    mockAnalyzeImage.mockResolvedValue({
      sakeName: '獺祭',
      confidence: 0.95,
      rawTexts: ['獺祭'],
    });

    render(<PurchaseForm />);

    // OCR トリガーボタンをクリック
    const ocrButton = screen.getByTestId('ocr-trigger-button');
    fireEvent.click(ocrButton);

    const sakeNameInput = screen.getByTestId('input-sakeName') as HTMLInputElement;

    // OCR 結果が反映されるのを待つ
    await waitFor(() => {
      expect(sakeNameInput.value).toBe('獺祭');
    });

    // 手動で編集できることを確認
    fireEvent.change(sakeNameInput, { target: { value: '久保田' } });
    expect(sakeNameInput.value).toBe('久保田');
  });
});
