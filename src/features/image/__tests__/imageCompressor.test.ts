/**
 * ImageCompressor ユニットテスト
 * Validates: Requirements 2.4, 2.7
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compressImage } from '../utils/imageCompressor';

// --- ヘルパー ---

/** 指定サイズのダミー File を生成 */
function createDummyFile(sizeBytes: number, type = 'image/jpeg', name = 'test.jpg'): File {
  const buffer = new ArrayBuffer(sizeBytes);
  return new File([buffer], name, { type });
}

const MB = 1024 * 1024;

// --- モック設定 ---

function setupBrowserMocks(opts: { blobSize?: number; toBlobFail?: boolean; imgLoadFail?: boolean; ctxFail?: boolean } = {}) {
  const { blobSize = 1 * MB, toBlobFail = false, imgLoadFail = false, ctxFail = false } = opts;

  // URL.createObjectURL / revokeObjectURL
  vi.stubGlobal('URL', {
    ...globalThis.URL,
    createObjectURL: vi.fn(() => 'blob:mock-url'),
    revokeObjectURL: vi.fn(),
  });

  // Image constructor
  vi.stubGlobal('Image', class MockImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 1000;
    naturalHeight = 800;
    private _src = '';
    get src() { return this._src; }
    set src(val: string) {
      this._src = val;
      // 非同期で onload/onerror を呼ぶ
      setTimeout(() => {
        if (imgLoadFail) {
          this.onerror?.();
        } else {
          this.onload?.();
        }
      }, 0);
    }
  });

  // document.createElement('canvas') のモック
  const mockDrawImage = vi.fn();
  const mockGetContext = vi.fn(() => {
    if (ctxFail) return null;
    return { drawImage: mockDrawImage };
  });
  const mockToBlob = vi.fn(
    (callback: (blob: Blob | null) => void, _type?: string, _quality?: number) => {
      if (toBlobFail) {
        callback(null);
      } else {
        callback(new Blob([new ArrayBuffer(blobSize)], { type: 'image/jpeg' }));
      }
    },
  );

  const origCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
    if (tag === 'canvas') {
      return {
        width: 0,
        height: 0,
        getContext: mockGetContext,
        toBlob: mockToBlob,
      } as unknown as HTMLCanvasElement;
    }
    return origCreateElement(tag, options);
  });

  return { mockDrawImage, mockGetContext, mockToBlob };
}

// --- テスト ---

describe('compressImage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('5MB以下のファイルは圧縮せずそのまま返す (wasCompressed: false)', async () => {
    const file = createDummyFile(3 * MB);
    const result = await compressImage(file);

    expect(result.wasCompressed).toBe(false);
    expect(result.file).toBe(file); // 同一オブジェクト
    expect(result.originalSize).toBe(3 * MB);
    expect(result.compressedSize).toBe(3 * MB);
  });

  it('ちょうど5MBのファイルは圧縮せずそのまま返す', async () => {
    const file = createDummyFile(5 * MB);
    const result = await compressImage(file);

    expect(result.wasCompressed).toBe(false);
    expect(result.file).toBe(file);
    expect(result.originalSize).toBe(5 * MB);
    expect(result.compressedSize).toBe(5 * MB);
  });

  it('5MB超のファイルを圧縮し wasCompressed: true を返す', async () => {
    setupBrowserMocks({ blobSize: 2 * MB });
    const file = createDummyFile(6 * MB);

    const result = await compressImage(file);

    expect(result.wasCompressed).toBe(true);
    expect(result.compressedSize).toBeLessThanOrEqual(5 * MB);
    expect(result.originalSize).toBe(6 * MB);
  });

  it('圧縮後のファイルは JPEG 形式 (image/jpeg) である', async () => {
    setupBrowserMocks({ blobSize: 2 * MB });
    const file = createDummyFile(6 * MB, 'image/png', 'photo.png');

    const result = await compressImage(file);

    expect(result.wasCompressed).toBe(true);
    expect(result.file.type).toBe('image/jpeg');
  });

  it('圧縮後のファイル名は元のファイル名を保持する', async () => {
    setupBrowserMocks({ blobSize: 2 * MB });
    const file = createDummyFile(6 * MB, 'image/jpeg', 'my-sake-label.jpg');

    const result = await compressImage(file);

    expect(result.file.name).toBe('my-sake-label.jpg');
  });

  it('画像の読み込みに失敗した場合エラーをスローする', async () => {
    setupBrowserMocks({ imgLoadFail: true });
    const file = createDummyFile(6 * MB);

    await expect(compressImage(file)).rejects.toThrow('画像の読み込みに失敗しました');
  });

  it('Canvas コンテキスト取得に失敗した場合エラーをスローする', async () => {
    setupBrowserMocks({ ctxFail: true });
    const file = createDummyFile(6 * MB);

    await expect(compressImage(file)).rejects.toThrow('Canvas コンテキストの取得に失敗しました');
  });

  it('toBlob が null を返した場合エラーをスローする', async () => {
    setupBrowserMocks({ toBlobFail: true });
    const file = createDummyFile(6 * MB);

    await expect(compressImage(file)).rejects.toThrow();
  });

  it('品質を下げても5MB以下にならず解像度縮小でも失敗した場合エラーをスローする', async () => {
    // 常に 6MB の Blob を返す → 全試行で 5MB 以下にならない
    setupBrowserMocks({ blobSize: 6 * MB });
    const file = createDummyFile(10 * MB);

    await expect(compressImage(file)).rejects.toThrow(
      '画像の圧縮に失敗しました。5MB以下の画像を選択してください',
    );
  });
});
