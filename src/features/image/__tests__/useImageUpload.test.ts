import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockGraphql = vi.hoisted(() => vi.fn());
const mockValidate = vi.hoisted(() => vi.fn());
const mockCompress = vi.hoisted(() => vi.fn());
const mockCreateThumbnail = vi.hoisted(() => vi.fn());
const mockCopyRecordImages = vi.hoisted(() => vi.fn());

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: mockGraphql }),
}));

vi.mock('../utils/imageValidator', () => ({
  validateRecordImageFile: mockValidate,
}));

vi.mock('../utils/imageCompressor', () => ({
  compressImage: mockCompress,
  createThumbnail: mockCreateThumbnail,
}));

vi.mock('../lib/copyRecordImages', () => ({
  copyRecordImages: mockCopyRecordImages,
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

// OCR の事前アップロードは記録の作成前に走るため、保存せず離れたキーが
// 孤児として残る。置き場を一時領域に分けてライフサイクルで消す（Issue #140）
describe('useImageUpload - 一時領域からの引き取り', () => {
  const TEMP_KEY = 'sub-1/tmp/upload-1/a.jpg';
  const FINAL_KEY = 'sub-1/purchase/rec-1/a.jpg';

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
    mockCopyRecordImages.mockReset();
    global.fetch = vi.fn();
  });

  /** 原画 + サムネイルの 2 回分の署名と PUT を積む */
  function mockUpload(key: string) {
    for (const k of [key, `thumb_${key}`]) {
      mockGraphql.mockResolvedValueOnce({
        data: {
          generateUploadUrl: {
            uploadUrl: `https://s3.example/${k}`,
            key: k,
            // 署名した側が返した値をそのまま送る決まり
            taggingHeader: 'lifecycle=temporary',
          },
        },
      });
      (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
      });
    }
  }

  it('事前アップロードは一時領域を要求し、タグ付きで PUT する', async () => {
    mockUpload(TEMP_KEY);

    const { result } = renderHook(() => useImageUpload());

    await act(async () => {
      await result.current.handleImageSelect(makeFile('a.jpg'));
    });
    await act(async () => {
      await result.current.preUploadImages('purchase');
    });

    // 署名要求に temporary が立っていること
    expect(mockGraphql).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({ temporary: true }),
      }),
    );
    // 署名にタグが含まれるため、PUT でも同じ値を送らないと 403 になる。
    // 値は自前で組み立てず、サーバーが返したものをそのまま使う
    const [, putInit] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(putInit.headers['x-amz-tagging']).toBe('lifecycle=temporary');
  });

  it('保存時に一時領域のキーを正式な場所へ複製して返す', async () => {
    mockUpload(TEMP_KEY);
    mockCopyRecordImages.mockResolvedValue([FINAL_KEY]);

    const { result } = renderHook(() => useImageUpload());

    await act(async () => {
      await result.current.handleImageSelect(makeFile('a.jpg'));
    });
    await act(async () => {
      await result.current.preUploadImages('purchase');
    });

    let keys: string[] = [];
    await act(async () => {
      keys = await result.current.uploadImages('purchase', 'rec-1');
    });

    expect(mockCopyRecordImages).toHaveBeenCalledWith([TEMP_KEY], 'purchase', 'rec-1');
    // 一時領域のキーを記録に持たせるとライフサイクルで実体だけが消える
    expect(keys).toEqual([FINAL_KEY]);
    expect(result.current.imageKeys).toEqual([FINAL_KEY]);
  });

  // 正式な場所にあるキーまで複製に出すと、複製先で名前がぶつかって連番が付き、
  // 元のオブジェクトが誰からも参照されなくなる（PR #145 のレビュー指摘）
  it('一時領域のキーだけを複製に出し、並び順は保つ', async () => {
    mockUpload(TEMP_KEY);
    mockCopyRecordImages.mockResolvedValue(['sub-1/purchase/rec-1/a.jpg']);

    const { result } = renderHook(() => useImageUpload());

    // 1 枚目は事前アップロード（一時領域）
    await act(async () => {
      await result.current.handleImageSelect(makeFile('a.jpg'));
    });
    await act(async () => {
      await result.current.preUploadImages('purchase');
    });

    // 2 枚目は保存時に正式な場所へ直接アップロードされる
    await act(async () => {
      await result.current.handleImageSelect(makeFile('b.jpg'));
    });
    mockUpload('sub-1/purchase/rec-1/b.jpg');

    let keys: string[] = [];
    await act(async () => {
      keys = await result.current.uploadImages('purchase', 'rec-1');
    });

    // 複製に出すのは一時領域のキーだけ
    expect(mockCopyRecordImages).toHaveBeenCalledWith([TEMP_KEY], 'purchase', 'rec-1');
    // 並びは元のまま（複製したものを同じ位置へ戻す）
    expect(keys).toEqual([
      'sub-1/purchase/rec-1/a.jpg',
      'sub-1/purchase/rec-1/b.jpg',
    ]);
  });

  it('複製に失敗したら登録を止める（消える画像を記録に紐づけない）', async () => {
    mockUpload(TEMP_KEY);
    mockCopyRecordImages.mockRejectedValue(new Error('copy failed'));

    const { result } = renderHook(() => useImageUpload());

    await act(async () => {
      await result.current.handleImageSelect(makeFile('a.jpg'));
    });
    await act(async () => {
      await result.current.preUploadImages('purchase');
    });

    let keys: string[] = ['dummy'];
    await act(async () => {
      keys = await result.current.uploadImages('purchase', 'rec-1');
    });

    expect(keys).toEqual([]);
    expect(result.current.error).not.toBeNull();
  });

  it('一時領域を経由していないキーは複製しない', async () => {
    mockUpload(FINAL_KEY);

    const { result } = renderHook(() => useImageUpload());

    await act(async () => {
      await result.current.handleImageSelect(makeFile('a.jpg'));
    });

    let keys: string[] = [];
    await act(async () => {
      keys = await result.current.uploadImages('purchase', 'rec-1');
    });

    expect(mockCopyRecordImages).not.toHaveBeenCalled();
    expect(keys).toEqual([FINAL_KEY]);
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

  // 以下は PR #144 の Security Agent レビューで挙がった、警告が実態とずれる経路。
  // 警告を 1 つの箱で上書きしていると、外した画像の警告が残ったり、
  // 残っている画像の問題が消えたりする
  it('警告を出した画像だけを外すと警告も消える', async () => {
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
      result.current.removeImage(0);
    });

    expect(result.current.warning).toBeNull();
  });

  it('読めない画像を残したまま別の画像を足しても警告は消えない', async () => {
    mockCompress.mockImplementationOnce(async (file: File) => ({
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
    await act(async () => {
      await result.current.handleImageSelect(makeFile('good.jpg'));
    });

    // 1 枚目が読めない事実は、2 枚目を足しても変わらない
    expect(result.current.warning).toContain('原寸のまま保存される');
  });

  it('2 枚のうち片方だけ読めない場合、その画像を外せば警告が消える', async () => {
    mockCompress.mockImplementationOnce(async (file: File) => ({
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
    await act(async () => {
      await result.current.handleImageSelect(makeFile('good.jpg'));
    });

    await act(async () => {
      result.current.removeImage(0);
    });

    expect(result.current.imageFiles).toHaveLength(1);
    expect(result.current.warning).toBeNull();
  });

  it('読み込み失敗の警告はサムネイル失敗の警告に上書きされない', async () => {
    mockCompress.mockImplementation(async (file: File) => ({
      file,
      originalSize: file.size,
      compressedSize: file.size,
      wasCompressed: false,
      wasReadable: false,
    }));
    // 読めない画像はサムネイルも作れないので、両方の失敗が同時に起きる
    mockCreateThumbnail.mockRejectedValue(new Error('読み込めません'));
    mockGraphql.mockResolvedValueOnce({
      data: { generateUploadUrl: { uploadUrl: 'https://s3.example/k', key: 'k' } },
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => useImageUpload());

    await act(async () => {
      await result.current.handleImageSelect(makeFile('a.jpg'));
    });
    await act(async () => {
      await result.current.uploadImages('purchase', 'rec-1');
    });

    // 縮小もサムネイルも無い方が状態が悪いので、そちらを出す
    expect(result.current.warning).toContain('原寸のまま保存される');
  });

  // 配列の範囲外へ代入すると穴が空き、undefined が警告として画面に出る
  // （PR #144 の 2 巡目レビュー指摘）
  // ファイル選択とドラッグ＆ドロップは、選んだ枚数だけ handleImageSelect を
  // 連続で呼ぶ。state の枚数で上限を見ると、全部が同じ描画時点の値を見て
  // 検査を通り抜ける（PR #144 の 3 巡目レビュー指摘）
  it('複数ファイルを一度に選んでも上限を超えない', async () => {
    const { result } = renderHook(() => useImageUpload());

    // 8 枚をまとめて選んだ状況（await を挟まずに呼ぶ）
    await act(async () => {
      await Promise.all(
        ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((n) =>
          result.current.handleImageSelect(makeFile(`${n}.jpg`)),
        ),
      );
    });

    expect(result.current.imageFiles).toHaveLength(5);
    expect(result.current.error).toContain('最大5枚');
  });

  it('外した分の枠は次の選択で使える', async () => {
    const { result } = renderHook(() => useImageUpload());

    await act(async () => {
      await Promise.all(
        ['a', 'b', 'c', 'd', 'e'].map((n) =>
          result.current.handleImageSelect(makeFile(`${n}.jpg`)),
        ),
      );
    });
    expect(result.current.imageFiles).toHaveLength(5);

    await act(async () => {
      result.current.removeImage(0);
    });
    await act(async () => {
      await result.current.handleImageSelect(makeFile('new.jpg'));
    });

    expect(result.current.imageFiles).toHaveLength(5);
    expect(result.current.imageFiles.at(-1)?.name).toBe('new.jpg');
  });

  it('選択が解除された画像の位置には警告を書かない', async () => {
    mockCreateThumbnail.mockRejectedValue(new Error('生成できません'));
    mockGraphql.mockResolvedValueOnce({
      data: { generateUploadUrl: { uploadUrl: 'https://s3.example/k', key: 'k' } },
    });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => useImageUpload());

    await act(async () => {
      await result.current.handleImageSelect(makeFile('a.jpg'));
    });

    await act(async () => {
      // アップロードの最中に画像が消えた状況を作る
      const upload = result.current.uploadImages('purchase', 'rec-1');
      result.current.clearImage();
      await upload;
    });

    // "undefined" が警告として表示されてはいけない
    expect(result.current.warning).toBeNull();
  });

  it('setImageFile でも警告の並びを揃える', async () => {
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

    // 後方互換の入口。ここで揃えないと画像が無いのに警告だけ残る
    await act(async () => {
      result.current.setImageFile(null);
    });

    expect(result.current.imageFiles).toHaveLength(0);
    expect(result.current.warning).toBeNull();
  });

  it('アップロード中は画像を外せない（警告の位置がずれるため）', async () => {
    mockGraphql.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                data: { generateUploadUrl: { uploadUrl: 'https://s3.example/k', key: 'k' } },
              }),
            20,
          );
        }),
    );
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useImageUpload());

    await act(async () => {
      await result.current.handleImageSelect(makeFile('a.jpg'));
    });

    await act(async () => {
      const upload = result.current.uploadImages('purchase', 'rec-1');
      // アップロード中の削除は無視される
      result.current.removeImage(0);
      await upload;
    });

    expect(result.current.imageFiles).toHaveLength(1);
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
