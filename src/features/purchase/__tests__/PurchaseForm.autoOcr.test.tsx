import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// sonner の toast をモック
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
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

// 過去評価ヒントをモック（fake timers との干渉を避ける）
vi.mock('@/features/purchase/hooks/usePastRatingHint', () => ({
  usePastRatingHint: () => ({ summaries: [] }),
}));

// useImageUpload をモック（画像1枚が選択済みの状態）
const testFile = new File(['test'], 'label.jpg', {
  type: 'image/jpeg',
  lastModified: 1700000000000,
});
const mockImageFiles: File[] = [testFile];
const mockPreUploadImages = vi.fn(async () => [
  'users/test-sub/purchase/test-id/label.jpg',
]);
vi.mock('@/features/image/hooks/useImageUpload', () => ({
  useImageUpload: () => ({
    imageFile: mockImageFiles[0] ?? null,
    imageFiles: mockImageFiles,
    setImageFile: vi.fn(),
    isCompressing: false,
    isUploading: false,
    error: null,
    imageKey: null,
    imageKeys: [],
    handleImageSelect: vi.fn(),
    removeImage: vi.fn(),
    uploadImage: vi.fn(),
    uploadImages: vi.fn(async () => []),
    preUploadImage: vi.fn(),
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

describe('PurchaseForm 自動OCR（写真1枚で購入登録）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    global.URL.createObjectURL = vi.fn(() => 'blob:test-url');
    global.URL.revokeObjectURL = vi.fn();
    mockAnalyzeImage.mockResolvedValue({
      sakeName: '獺祭 純米大吟醸45',
      category: 'NIHONSHU',
      region: '山口県',
      alcoholPercentage: 16,
      confidence: 0.9,
      rawTexts: ['{"sakeName":"獺祭 純米大吟醸45"}'],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ボタンを押さなくても、画像があれば自動でOCRが実行されフォームに反映される', async () => {
    render(<PurchaseForm />);

    // デバウンス経過前は実行されない
    expect(mockAnalyzeImage).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mockPreUploadImages).toHaveBeenCalledWith('purchase');
    expect(mockAnalyzeImage).toHaveBeenCalledTimes(1);

    const sakeNameInput = screen.getByTestId('input-sakeName') as HTMLInputElement;
    expect(sakeNameInput.value).toBe('獺祭 純米大吟醸45');

    // カテゴリ・メモ（産地・度数）も反映される
    expect(screen.getByTestId('input-category').textContent).toContain('日本酒');
    const memoInput = screen.getByTestId('input-memo') as HTMLTextAreaElement;
    expect(memoInput.value).toBe('産地: 山口県 / アルコール度数: 16%');
  });

  it('自動実行では入力済みの銘柄名を上書きしない', async () => {
    render(<PurchaseForm />);

    const sakeNameInput = screen.getByTestId('input-sakeName') as HTMLInputElement;
    fireEvent.change(sakeNameInput, { target: { value: '久保田' } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mockAnalyzeImage).toHaveBeenCalledTimes(1);
    // 銘柄名は保持しつつ、カテゴリ・メモは反映される
    expect(sakeNameInput.value).toBe('久保田');
    const memoInput = screen.getByTestId('input-memo') as HTMLTextAreaElement;
    expect(memoInput.value).toBe('産地: 山口県 / アルコール度数: 16%');
  });

  it('解析済みの画像に対して自動OCRが重複実行されない', async () => {
    render(<PurchaseForm />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mockAnalyzeImage).toHaveBeenCalledTimes(1);

    // さらに時間が経過しても再実行されない
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mockAnalyzeImage).toHaveBeenCalledTimes(1);
  });

  it('画像アップロードに失敗した場合、解析は実行されずボタンは「銘柄名を読み取る」のまま', async () => {
    mockPreUploadImages.mockResolvedValueOnce([]);

    render(<PurchaseForm />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mockPreUploadImages).toHaveBeenCalledTimes(1);
    expect(mockAnalyzeImage).not.toHaveBeenCalled();
    // 読み取り未実施なのでボタンは「再読み取り」表記にならない
    expect(screen.getByTestId('ocr-trigger-button')).toHaveTextContent('銘柄名を読み取る');
    // 失敗した画像への自動リトライはしない（手動ボタンに委ねる）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mockPreUploadImages).toHaveBeenCalledTimes(1);
  });

  it('自動実行後もボタン（再読み取り）から手動でOCRを実行でき、銘柄名を上書きする', async () => {
    render(<PurchaseForm />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mockAnalyzeImage).toHaveBeenCalledTimes(1);

    // 手動で銘柄名を書き換えた後、再読み取りボタンを押すと上書きされる
    const sakeNameInput = screen.getByTestId('input-sakeName') as HTMLInputElement;
    fireEvent.change(sakeNameInput, { target: { value: '久保田' } });

    const ocrButton = screen.getByTestId('ocr-trigger-button');
    expect(ocrButton).toHaveTextContent('ラベルを再読み取り');

    await act(async () => {
      fireEvent.click(ocrButton);
      await vi.runAllTimersAsync();
    });

    expect(mockAnalyzeImage).toHaveBeenCalledTimes(2);
    expect(sakeNameInput.value).toBe('獺祭 純米大吟醸45');
  });
});
