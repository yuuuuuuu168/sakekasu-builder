import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockGraphql = vi.hoisted(() => vi.fn());
const mockValidate = vi.hoisted(() => vi.fn());
const mockCompress = vi.hoisted(() => vi.fn());

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: mockGraphql }),
}));

vi.mock('../utils/imageValidator', () => ({
  validateImageFile: mockValidate,
}));

vi.mock('../utils/imageCompressor', () => ({
  compressImage: mockCompress,
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
    }));
    global.fetch = vi.fn();
  });

  /** 1 枚分の generateUploadUrl + S3 PUT のモックをキューに積む */
  function mockUploadUrl(key: string) {
    mockGraphql.mockResolvedValueOnce({
      data: {
        generateUploadUrl: { uploadUrl: `https://s3.example/${key}`, key },
      },
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
    });
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
    expect(mockGraphql).toHaveBeenCalledTimes(3);
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
    // GraphQL 呼び出し: preUpload 1 回 + uploadImages で 2 回 = 計 3 回
    expect(mockGraphql).toHaveBeenCalledTimes(3);
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
    expect(mockGraphql).toHaveBeenCalledTimes(2);
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
