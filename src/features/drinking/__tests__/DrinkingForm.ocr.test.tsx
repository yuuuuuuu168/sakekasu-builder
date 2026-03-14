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

// useDrinkingStorage をモック
const mockSaveDrinking = vi.fn(async () => ({ success: true }));
vi.mock('@/features/drinking/hooks/useDrinkingStorage', () => ({
  useDrinkingStorage: () => ({
    saveDrinking: mockSaveDrinking,
    isSaving: false,
  }),
}));

// useImageUpload をモック（画像あり + preUploadImage 対応）
const mockPreUploadImage = vi.fn(async () => 'users/test-sub/drinking/test-id/test.jpg');
vi.mock('@/features/image/hooks/useImageUpload', () => ({
  useImageUpload: () => ({
    imageFile: new File(['test'], 'test.jpg', { type: 'image/jpeg' }),
    setImageFile: vi.fn(),
    isCompressing: false,
    isUploading: false,
    error: null,
    imageKey: 'users/test-sub/drinking/test-id/test.jpg',
    handleImageSelect: vi.fn(),
    uploadImage: vi.fn(async () => 'users/test-sub/drinking/test-id/test.jpg'),
    preUploadImage: mockPreUploadImage,
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

import { DrinkingForm } from '../components/DrinkingForm';

describe('DrinkingForm OCR 統合テスト', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveDrinking.mockResolvedValue({ success: true });
    global.URL.createObjectURL = vi.fn(() => 'blob:test-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('OCR ボタンクリックで analyzeImage が呼ばれ、結果が sakeName に反映される', async () => {
    mockAnalyzeImage.mockResolvedValue({
      sakeName: '獺祭',
      confidence: 0.95,
      rawTexts: ['獺祭'],
    });

    render(<DrinkingForm />);

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

    render(<DrinkingForm />);

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
});
