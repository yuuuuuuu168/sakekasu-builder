import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockGraphql = vi.hoisted(() => vi.fn());
const mockValidate = vi.hoisted(() => vi.fn());
const mockCompress = vi.hoisted(() => vi.fn());
const mockCreateThumbnail = vi.hoisted(() => vi.fn());

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: mockGraphql }),
}));

vi.mock('../utils/imageValidator', () => ({
  validateImageFile: mockValidate,
}));

vi.mock('../utils/imageCompressor', () => ({
  compressImage: mockCompress,
  createThumbnail: mockCreateThumbnail,
}));

import { useImageUpload } from '../hooks/useImageUpload';

function makeFile(name: string): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}

describe('useImageUpload - uploadImages', () => {
  beforeEach(() => {
    mockGraphql.mockReset();
    mockValidate.mockReset();
    mockValidate.mockReturnValue({ valid: true });
    mockCompress.mockReset();
    // 正規化不要の画像はそのまま返る挙動を再現
    mockCompress.mockImplementation(async (file: File) => ({
      file,
      originalSize: file.size,
      compressedSize: file.size,
      wasCompressed: false,
      wasReadable: true,
    }));
    mockCreateThumbnail.mockReset();
    mockCreateThumbnail.mockImplementation(
      async (_file: File, fileName: string) =>
        new File(['t'], fileName, { type: 'image/jpeg' }),
    );
    global.fetch = vi.fn();
  });

  /** generateUploadUrl + S3 PUT のモックを 1 回分キューに積む */
  function mockSignedPut(key: string) {
    mockGraphql.mockResolvedValueOnce({
      data: {
        generateUploadUrl: { uploadUrl: `https://s3.example/${key}`, key },
      },
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
    });
  }

  /**
   * 画像 1 枚分のアップロードをキューに積む。
   *
   * 1 枚につき原画とサムネイルの 2 回 PUT する。サムネイル分を積み忘れると
   * 「サムネイルが作られない」状態がテストでは成功に見えてしまう（Issue #137）
   */
  function mockUploadUrl(key: string) {
    mockSignedPut(key);
    mockSignedPut(`thumb_${key}`);
  }

  it('全ファイルが未アップロードなら全部アップロードする', async () => {
    mockUploadUrl('key-0');
    mockUploadUrl('key-1');
    mockUploadUrl('key-2');

    const { result } = renderHook(() => useImageUpload());

    await act(async () => {
      await result.current.handleImageSelect(makeFile('a.jpg'));
    });
    await act(async () => {
      await result.current.handleImageSelect(makeFile('b.jpg'));
    });
    await act(async () => {
      await result.current.handleImageSelect(makeFile('c.jpg'));
    });

    let keys: string[] = [];
    await act(async () => {
      keys = await result.current.uploadImages('purchase', 'rec-1');
    });

    expect(keys).toEqual(['key-0', 'key-1', 'key-2']);
    // 3 枚 × (原画 + サムネイル)
    expect(mockGraphql).toHaveBeenCalledTimes(6);
    expect(result.current.warning).toBeNull();
  });

  it('OCR 事前アップロード済みの 1 枚目は再利用し、残りだけアップロードする（バグ再発防止）', async () => {
    // preUploadImage 用
    mockUploadUrl('ocr-pre-0');

    const { result } = renderHook(() => useImageUpload());

    // 1 枚追加 + OCR 事前アップロード
    await act(async () => {
      await result.current.handleImageSelect(makeFile('first.jpg'));
    });
    await act(async () => {
      await result.current.preUploadImage('purchase');
    });

    expect(result.current.imageKeys).toEqual(['ocr-pre-0']);

    // その後にさらに 2 枚追加
    await act(async () => {
      await result.current.handleImageSelect(makeFile('second.jpg'));
    });
    await act(async () => {
      await result.current.handleImageSelect(makeFile('third.jpg'));
    });

    // 保存時の uploadImages：2〜3 枚目だけアップロード
    mockUploadUrl('key-1');
    mockUploadUrl('key-2');

    let keys: string[] = [];
    await act(async () => {
      keys = await result.current.uploadImages('purchase', 'rec-1');
    });

    expect(keys).toEqual(['ocr-pre-0', 'key-1', 'key-2']);
    // GraphQL 呼び出し: preUpload 1 枚 + uploadImages 2 枚 = 3 枚 × (原画 + サムネイル)
    expect(mockGraphql).toHaveBeenCalledTimes(6);
  });

  it('全ファイル分のキーが揃っている場合は再アップロードしない', async () => {
    mockUploadUrl('key-0');
    mockUploadUrl('key-1');

    const { result } = renderHook(() => useImageUpload());

    await act(async () => {
      await result.current.handleImageSelect(makeFile('a.jpg'));
    });
    await act(async () => {
      await result.current.handleImageSelect(makeFile('b.jpg'));
    });

    await act(async () => {
      await result.current.uploadImages('purchase', 'rec-1');
    });

    // 2 回目の呼び出しではアップロードが発生しないこと
    let keys: string[] = [];
    await act(async () => {
      keys = await result.current.uploadImages('purchase', 'rec-2');
    });

    expect(keys).toEqual(['key-0', 'key-1']);
    // 2 枚 × (原画 + サムネイル)。2 回目の uploadImages では増えない
    expect(mockGraphql).toHaveBeenCalledTimes(4);
  });

  it('ファイルが 1 枚もなければ空配列を返す', async () => {
    const { result } = renderHook(() => useImageUpload());

    let keys: string[] = ['dummy'];
    await act(async () => {
      keys = await result.current.uploadImages('purchase', 'rec-1');
    });

    expect(keys).toEqual([]);
    expect(mockGraphql).not.toHaveBeenCalled();
  });
});

// 保存は成立するのに表示だけが重くなる失敗は、伝えないと誰も気づけない。
// 実際に「サムネイルが 1 件も作られていない」状態が 4 ヶ月続いた（Issue #137）
describe('useImageUpload - 品質低下の警告', () => {
  beforeEach(() => {
    mockGraphql.mockReset();
    mockValidate.mockReset();
    mockValidate.mockReturnValue({ valid: true });
    mockCompress.mockReset();
    mockCompress.mockImplementation(async (file: File) => ({
      file,
      originalSize: file.size,
      compressedSize: file.size,
      wasCompressed: false,
      wasReadable: true,
    }));
    mockCreateThumbnail.mockReset();
    mockCreateThumbnail.mockImplementation(
      async (_file: File, fileName: string) =>
        new File(['t'], fileName, { type: 'image/jpeg' }),
    );
    global.fetch = vi.fn();
  });

  it('読み込めなかった画像を選ぶと警告を出す', async () => {
    mockCompress.mockImplementation(async (file: File) => ({
      file,
      originalSize: file.size,
      compressedSize: file.size,
      wasCompressed: false,
      wasReadable: false,
    }));

    const { result } = renderHook(() => useImageUpload());

    await act(async () => {
      await result.current.handleImageSelect(makeFile('unreadable.jpg'));
    });

    expect(result.current.warning).toContain('原寸のまま保存される');
    // 保存自体は止めない。写真を残せる方が利用者の損は小さい
    expect(result.current.error).toBeNull();
    expect(result.current.imageFiles).toHaveLength(1);
  });

  it('サムネイルを生成できなければ警告を出す', async () => {
    mockCreateThumbnail.mockRejectedValue(new Error('画像の読み込みに失敗しました'));
    // 原画だけがアップロードされる
    mockGraphql.mockResolvedValueOnce({
      data: { generateUploadUrl: { uploadUrl: 'https://s3.example/k', key: 'k' } },
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => useImageUpload());

    await act(async () => {
      await result.current.handleImageSelect(makeFile('a.jpg'));
    });

    let keys: string[] = [];
    await act(async () => {
      keys = await result.current.uploadImages('purchase', 'rec-1');
    });

    // 原画は保存できているので登録は通す
    expect(keys).toEqual(['k']);
    expect(result.current.warning).toContain('縮小画像を作れませんでした');
  });

  it('サムネイルのアップロードが失敗した場合も警告を出す（例外にならない経路）', async () => {
    // 原画は成功、サムネイルの generateUploadUrl だけエラーを返す。
    // putToS3 は失敗を例外ではなく null で返すため、戻り値を見ないと素通りする
    mockGraphql.mockResolvedValueOnce({
      data: { generateUploadUrl: { uploadUrl: 'https://s3.example/k', key: 'k' } },
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    mockGraphql.mockResolvedValueOnce({ errors: [{ message: 'Invalid fileName' }] });

    const { result } = renderHook(() => useImageUpload());

    await act(async () => {
      await result.current.handleImageSelect(makeFile('a.jpg'));
    });

    await act(async () => {
      await result.current.uploadImages('purchase', 'rec-1');
    });

    expect(result.current.warning).toContain('縮小画像を作れませんでした');
  });

  it('画像をすべて外すと警告も消える', async () => {
    mockCompress.mockImplementation(async (file: File) => ({
      file,
      originalSize: file.size,
      compressedSize: file.size,
      wasCompressed: false,
      wasReadable: false,
    }));

    const { result } = renderHook(() => useImageUpload());

    await act(async () => {
      await result.current.handleImageSelect(makeFile('unreadable.jpg'));
    });
    expect(result.current.warning).not.toBeNull();

    await act(async () => {
      result.current.clearImage();
    });

    expect(result.current.warning).toBeNull();
  });
});
