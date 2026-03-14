import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ImageUploadArea, type ImageUploadAreaProps } from '../components/ImageUploadArea';

// URL.createObjectURL / revokeObjectURL のモック
const mockCreateObjectURL = vi.fn(() => 'blob:test-url');
const mockRevokeObjectURL = vi.fn();

beforeEach(() => {
  global.URL.createObjectURL = mockCreateObjectURL;
  global.URL.revokeObjectURL = mockRevokeObjectURL;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mockFile = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

function renderUploadArea(overrides: Partial<ImageUploadAreaProps> = {}) {
  const defaultProps: ImageUploadAreaProps = {
    imageFile: null,
    onImageChange: vi.fn(),
    isCompressing: false,
    error: null,
    ...overrides,
  };
  return { ...render(<ImageUploadArea {...defaultProps} />), props: defaultProps };
}

describe('ImageUploadArea OCR 機能', () => {
  // Requirements 1.1: 画像選択時に OCR ボタンが表示される
  it('画像選択時かつ onOcrTrigger が渡されている場合に OCR ボタンが表示される', () => {
    renderUploadArea({
      imageFile: mockFile,
      onOcrTrigger: vi.fn(),
    });

    const ocrButton = screen.getByTestId('ocr-trigger-button');
    expect(ocrButton).toBeInTheDocument();
  });

  // Requirements 1.2: OCR ボタンのラベルテキスト
  it('OCR ボタンに「銘柄名を読み取る」というラベルが表示される', () => {
    renderUploadArea({
      imageFile: mockFile,
      onOcrTrigger: vi.fn(),
    });

    expect(screen.getByTestId('ocr-trigger-button')).toHaveTextContent('銘柄名を読み取る');
  });

  // Requirements 1.6: 画像未選択時に OCR ボタンが非表示
  it('画像未選択時に OCR ボタンが表示されない', () => {
    renderUploadArea({
      imageFile: null,
      onOcrTrigger: vi.fn(),
    });

    expect(screen.queryByTestId('ocr-trigger-button')).not.toBeInTheDocument();
  });

  // onOcrTrigger が渡されていない場合も OCR ボタンが非表示
  it('onOcrTrigger が未指定の場合に OCR ボタンが表示されない', () => {
    renderUploadArea({
      imageFile: mockFile,
    });

    expect(screen.queryByTestId('ocr-trigger-button')).not.toBeInTheDocument();
  });

  // Requirements 1.3: OCR ボタンクリックで onOcrTrigger が呼ばれる
  it('OCR ボタンクリックで onOcrTrigger が呼ばれる', () => {
    const onOcrTrigger = vi.fn();
    renderUploadArea({
      imageFile: mockFile,
      onOcrTrigger,
    });

    fireEvent.click(screen.getByTestId('ocr-trigger-button'));
    expect(onOcrTrigger).toHaveBeenCalledTimes(1);
  });

  // Requirements 1.4: 解析中はボタン無効化・ラベル変更
  it('isOcrAnalyzing=true 時にボタンが無効化され「読み取り中...」が表示される', () => {
    renderUploadArea({
      imageFile: mockFile,
      onOcrTrigger: vi.fn(),
      isOcrAnalyzing: true,
    });

    const ocrButton = screen.getByTestId('ocr-trigger-button');
    expect(ocrButton).toBeDisabled();
    expect(ocrButton).toHaveTextContent('読み取り中...');
  });

  // Requirements 1.5: 解析中は削除ボタンが非表示（isInteractive が false になるため）
  it('isOcrAnalyzing=true 時に画像削除ボタンが非表示になる', () => {
    renderUploadArea({
      imageFile: mockFile,
      onOcrTrigger: vi.fn(),
      isOcrAnalyzing: true,
    });

    expect(screen.queryByTestId('image-delete-button')).not.toBeInTheDocument();
  });

  // 解析中でない場合は削除ボタンが表示される（対照テスト）
  it('isOcrAnalyzing=false 時に画像削除ボタンが表示される', () => {
    renderUploadArea({
      imageFile: mockFile,
      onOcrTrigger: vi.fn(),
      isOcrAnalyzing: false,
    });

    expect(screen.getByTestId('image-delete-button')).toBeInTheDocument();
  });

  // Requirements 4.3: 成功メッセージの表示
  it('ocrMessage（success）が渡された場合に成功メッセージが表示される', () => {
    renderUploadArea({
      imageFile: mockFile,
      onOcrTrigger: vi.fn(),
      ocrMessage: { text: '銘柄名を読み取りました: 獺祭', variant: 'success' },
    });

    expect(screen.getByTestId('image-status-success')).toBeInTheDocument();
    expect(screen.getByText('銘柄名を読み取りました: 獺祭')).toBeInTheDocument();
  });

  // Requirements 5.1: エラーメッセージの表示
  it('ocrMessage（error）が渡された場合にエラーメッセージが表示される', () => {
    renderUploadArea({
      imageFile: mockFile,
      onOcrTrigger: vi.fn(),
      ocrMessage: { text: '銘柄名を読み取れませんでした。手動で入力してください', variant: 'error' },
    });

    expect(screen.getByTestId('image-status-error')).toBeInTheDocument();
    expect(screen.getByText('銘柄名を読み取れませんでした。手動で入力してください')).toBeInTheDocument();
  });

  // ocrMessage が null の場合はメッセージが表示されない
  it('ocrMessage が null の場合は OCR メッセージが表示されない', () => {
    renderUploadArea({
      imageFile: mockFile,
      onOcrTrigger: vi.fn(),
      ocrMessage: null,
    });

    expect(screen.queryByTestId('image-status-success')).not.toBeInTheDocument();
    expect(screen.queryByTestId('image-status-error')).not.toBeInTheDocument();
  });
});
