import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ImageUploadArea, type ImageUploadAreaProps } from '../components/ImageUploadArea';

// URL.createObjectURL / revokeObjectURL のモック
const mockCreateObjectURL = vi.fn(() => 'blob:mock-preview-url');
const mockRevokeObjectURL = vi.fn();

beforeEach(() => {
  global.URL.createObjectURL = mockCreateObjectURL;
  global.URL.revokeObjectURL = mockRevokeObjectURL;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

describe('ImageUploadArea', () => {
  // 要件 1.3, 1.4: ドロップ領域と案内テキストの表示
  it('画像未選択時にドロップ領域と案内テキストを表示する', () => {
    renderUploadArea();
    expect(screen.getByTestId('image-drop-zone')).toBeInTheDocument();
    expect(screen.getByText('画像を選択またはドラッグ＆ドロップ')).toBeInTheDocument();
  });

  // 要件 1.6: ファイル選択で onImageChange が呼ばれる
  it('ファイル選択時に onImageChange が呼ばれる', () => {
    const onImageChange = vi.fn();
    renderUploadArea({ onImageChange });

    const input = screen.getByTestId('image-file-input');
    const file = new File(['test'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(onImageChange).toHaveBeenCalledWith(file);
  });

  // 要件 1.6: ドラッグ＆ドロップで onImageChange が呼ばれる
  it('ドラッグ＆ドロップ時に onImageChange が呼ばれる', () => {
    const onImageChange = vi.fn();
    renderUploadArea({ onImageChange });

    const dropZone = screen.getByTestId('image-drop-zone');
    const file = new File(['test'], 'label.png', { type: 'image/png' });

    fireEvent.dragOver(dropZone, { dataTransfer: { files: [file] } });
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    expect(onImageChange).toHaveBeenCalledWith(file);
  });

  // 要件 1.6: プレビュー表示
  it('imageFile が設定されている場合にプレビューを表示する', () => {
    const file = new File(['img'], 'sake.jpg', { type: 'image/jpeg' });
    renderUploadArea({ imageFile: file });

    expect(screen.getByTestId('image-preview')).toBeInTheDocument();
    expect(screen.getByAltText('選択された画像のプレビュー')).toBeInTheDocument();
    expect(mockCreateObjectURL).toHaveBeenCalledWith(file);
  });

  // 要件 1.7: プレビュー表示時に削除ボタンが表示される
  it('プレビュー表示時に削除ボタンが表示される', () => {
    const file = new File(['img'], 'sake.jpg', { type: 'image/jpeg' });
    renderUploadArea({ imageFile: file });

    expect(screen.getByTestId('image-delete-button')).toBeInTheDocument();
    expect(screen.getByLabelText('画像を削除')).toBeInTheDocument();
  });

  // 要件 1.8: 削除ボタンクリックで onImageChange(null) が呼ばれる
  it('削除ボタンクリックで onImageChange(null) が呼ばれる', () => {
    const onImageChange = vi.fn();
    const file = new File(['img'], 'sake.jpg', { type: 'image/jpeg' });
    renderUploadArea({ imageFile: file, onImageChange });

    fireEvent.click(screen.getByTestId('image-delete-button'));
    expect(onImageChange).toHaveBeenCalledWith(null);
  });

  // 要件 2.5: 圧縮中メッセージの表示
  it('isCompressing が true のとき「画像を圧縮中...」を表示する', () => {
    renderUploadArea({ isCompressing: true });
    expect(screen.getByText('画像を圧縮中...')).toBeInTheDocument();
  });

  // エラーメッセージの表示
  it('error が設定されている場合にエラーメッセージを表示する', () => {
    renderUploadArea({ error: 'JPEG または PNG 形式の画像を選択してください' });
    expect(screen.getByText('JPEG または PNG 形式の画像を選択してください')).toBeInTheDocument();
  });

  // 要件 3.7: アップロード中の表示
  it('isUploading が true のとき「画像をアップロード中...」を表示する', () => {
    renderUploadArea({ isUploading: true });
    expect(screen.getByText('画像をアップロード中...')).toBeInTheDocument();
  });
});
