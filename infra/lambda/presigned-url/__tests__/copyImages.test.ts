// copyImages（在庫から飲むときの画像引き継ぎ）の振る舞い。
//
// キーの文字列だけを共有させると、片方の記録を削除したときに deleteImage が
// S3 の実体を消して、もう片方の画像まで見えなくなる。実体ごと複製する経路の
// 取り決めをここで固定する。

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();

class FakeCopyObjectCommand {
  constructor(public input: { Bucket: string; Key: string; CopySource: string }) {}
}
class FakeHeadObjectCommand {
  constructor(public input: { Bucket: string; Key: string }) {}
}
class FakeListObjectsV2Command {
  constructor(public input: { Bucket: string; Prefix: string }) {}
}

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = sendMock;
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
  GetObjectCommand: class {
    constructor(public input: unknown) {}
  },
  DeleteObjectCommand: class {
    constructor(public input: unknown) {}
  },
  CopyObjectCommand: FakeCopyObjectCommand,
  HeadObjectCommand: FakeHeadObjectCommand,
  ListObjectsV2Command: FakeListObjectsV2Command,
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://example.invalid/signed'),
}));

process.env.BUCKET_NAME = 'dev-sakekasu-images';

const { handler } = await import('../index.js');

const OWNER = '11111111-1111-1111-1111-111111111111';
const VICTIM = '22222222-2222-2222-2222-222222222222';
const RECORD_ID = '33333333-3333-3333-3333-333333333333';

/** サムネイルが「ある」ものとして振る舞わせる */
function thumbnailsExist(): void {
  sendMock.mockImplementation(async () => ({}));
}

/** サムネイルが「ない」ものとして振る舞わせる（SDK は name に NotFound を入れる） */
function thumbnailsMissing(): void {
  sendMock.mockImplementation(async (command: unknown) => {
    if (command instanceof FakeHeadObjectCommand) {
      const error = new Error('NotFound');
      error.name = 'NotFound';
      Object.assign(error, { $metadata: { httpStatusCode: 404 } });
      throw error;
    }
    return {};
  });
}

/**
 * 実際にコピーされた (コピー元 → コピー先) の一覧。
 *
 * CopySource は URL エンコードされて渡るので、比較しやすいよう戻す
 */
function copies(): [string, string][] {
  return sendMock.mock.calls
    .map((call) => call[0])
    .filter((c): c is FakeCopyObjectCommand => c instanceof FakeCopyObjectCommand)
    .map((c) => [
      decodeURIComponent(c.input.CopySource).replace('dev-sakekasu-images/', ''),
      c.input.Key,
    ]);
}

/** 実際に渡された CopySource（エンコードしたまま） */
function rawCopySources(): string[] {
  return sendMock.mock.calls
    .map((call) => call[0])
    .filter((c): c is FakeCopyObjectCommand => c instanceof FakeCopyObjectCommand)
    .map((c) => c.input.CopySource);
}

async function callCopyImages(args: {
  sourceKeys: string[];
  recordType?: string;
  recordId?: string;
  sub?: string | null;
}): Promise<string[]> {
  const result = await handler({
    info: { fieldName: 'copyImages' },
    arguments: {
      sourceKeys: args.sourceKeys,
      recordType: args.recordType ?? 'drinking',
      recordId: args.recordId ?? RECORD_ID,
    },
    identity: args.sub === null ? null : { sub: args.sub ?? OWNER },
  } as Parameters<typeof handler>[0]);
  return result as string[];
}

describe('copyImages', () => {
  beforeEach(() => {
    sendMock.mockReset();
    thumbnailsExist();
  });

  it('原画とサムネイルを、指定した記録のキーへ複製する', async () => {
    const result = await callCopyImages({
      sourceKeys: [`${OWNER}/purchase/rec-1/IMG_3206.jpeg`],
    });

    expect(result).toEqual([`${OWNER}/drinking/${RECORD_ID}/IMG_3206.jpeg`]);
    expect(copies()).toEqual([
      [`${OWNER}/purchase/rec-1/IMG_3206.jpeg`, `${OWNER}/drinking/${RECORD_ID}/IMG_3206.jpeg`],
      [
        `${OWNER}/purchase/rec-1/thumb_IMG_3206.jpeg`,
        `${OWNER}/drinking/${RECORD_ID}/thumb_IMG_3206.jpeg`,
      ],
    ]);
  });

  // サムネイルは記録に保存されず原画から導出する。未生成の記録もあるので、
  // 無いときは原画だけ複製して落とさない（一覧は原画へフォールバックする）
  it('サムネイルが無ければ原画だけ複製する', async () => {
    thumbnailsMissing();

    const result = await callCopyImages({
      sourceKeys: [`${OWNER}/purchase/rec-1/IMG_3206.jpeg`],
    });

    expect(result).toHaveLength(1);
    expect(copies()).toEqual([
      [`${OWNER}/purchase/rec-1/IMG_3206.jpeg`, `${OWNER}/drinking/${RECORD_ID}/IMG_3206.jpeg`],
    ]);
  });

  // 一時領域（{sub}/tmp/...）の画像には自動削除タグが付いている。CopyObject の
  // 既定はタグの引き継ぎなので、外さないと記録に紐づけた画像が 1 日で消える（Issue #140）
  it('複製先に自動削除タグを引き継がない', async () => {
    await callCopyImages({
      sourceKeys: [`${OWNER}/tmp/upload-1/IMG_3206.jpeg`],
    });

    const copyInputs = sendMock.mock.calls
      .map((call) => call[0])
      .filter((c): c is FakeCopyObjectCommand => c instanceof FakeCopyObjectCommand)
      .map((c) => c.input as { TaggingDirective?: string; Tagging?: string });

    // 原画とサムネイルの両方
    expect(copyInputs).toHaveLength(2);
    for (const input of copyInputs) {
      expect(input.TaggingDirective).toBe('REPLACE');
      expect(input.Tagging).toBe('');
    }
  });

  // 一時領域からの引き取りが本来の使い道。記録に紐づく場所へ移せること
  it('一時領域の画像を記録のキーへ複製する', async () => {
    const result = await callCopyImages({
      sourceKeys: [`${OWNER}/tmp/upload-1/IMG_3206.jpeg`],
    });

    expect(result).toEqual([`${OWNER}/drinking/${RECORD_ID}/IMG_3206.jpeg`]);
  });

  // 同じキーが 2 回入っている記録があり、そのまま複製すると同じ画像が並ぶ
  it('同じキーが複数あっても1枚にまとめる', async () => {
    const key = `${OWNER}/purchase/rec-1/image.jpg`;

    const result = await callCopyImages({ sourceKeys: [key, key] });

    expect(result).toEqual([`${OWNER}/drinking/${RECORD_ID}/image.jpg`]);
  });

  // 別フォルダの同名ファイルを 1 つの記録へ集めると、コピー先で名前がぶつかる
  it('別々のフォルダにある同名ファイルは連番で分ける', async () => {
    const result = await callCopyImages({
      sourceKeys: [`${OWNER}/purchase/rec-1/image.jpg`, `${OWNER}/purchase/rec-2/image.jpg`],
    });

    expect(result).toEqual([
      `${OWNER}/drinking/${RECORD_ID}/image.jpg`,
      `${OWNER}/drinking/${RECORD_ID}/image-2.jpg`,
    ]);
  });

  // サムネイルは原画名から導出する決まりで、連番を振って避けられない。
  // 原画名を決める時点で導出先も押さえないと、「先に入れた画像のサムネイル」と
  // 「後から入れた画像の原画」が同じキーになって片方が消える。
  // `thumb_` を含むファイル名は利用者が普通に付けられるので現実に起こりうる
  it.each([
    ['原画→thumb_付きの順', ['photo.jpg', 'thumb_photo.jpg']],
    ['thumb_付き→原画の順', ['thumb_photo.jpg', 'photo.jpg']],
  ])('%s でも複製先が重ならない', async (_label, fileNames) => {
    const result = await callCopyImages({
      sourceKeys: fileNames.map((name, i) => `${OWNER}/purchase/rec-${i + 1}/${name}`),
    });

    // 原画の複製先どうしが重ならない
    expect(new Set(result).size).toBe(result.length);

    // サムネイルを含めても、同じキーへ 2 回書き込まない
    const written = copies().map(([, destination]) => destination);
    expect(new Set(written).size).toBe(written.length);
  });

  // 同じ規則が backfill-stock-drinking-images.py にもある。付け方が食い違うと
  // 同じ入力から違うキーが生まれるので、決まった名前をここで固定しておく
  it('名前の付け替え方が決まっている（バックフィルの実装と揃える）', async () => {
    const result = await callCopyImages({
      sourceKeys: [
        `${OWNER}/purchase/rec-1/photo.jpg`,
        `${OWNER}/purchase/rec-2/thumb_photo.jpg`,
        `${OWNER}/purchase/rec-3/photo.jpg`,
      ],
    });

    // 3枚目が photo-2 ではなく photo-3 になるのは、photo-2 の導出先
    // （thumb_photo-2）を2枚目が先に取っているため。原画とサムネイルを
    // 対で確保する規則から出る結果で、両方の実装で同じにならないといけない
    expect(result).toEqual([
      `${OWNER}/drinking/${RECORD_ID}/photo.jpg`,
      `${OWNER}/drinking/${RECORD_ID}/thumb_photo-2.jpg`,
      `${OWNER}/drinking/${RECORD_ID}/photo-3.jpg`,
    ]);
  });

  // 元がすでにサムネイルなら、そこからさらに導出しても在りもしないキーを
  // 探すだけになる（deleteImage 側と揃える）
  it('元が thumb_ 始まりなら、サムネイルの複製を試みない', async () => {
    await callCopyImages({ sourceKeys: [`${OWNER}/purchase/rec-1/thumb_photo.jpg`] });

    const looked = sendMock.mock.calls
      .map((call) => call[0])
      .filter((c): c is FakeHeadObjectCommand => c instanceof FakeHeadObjectCommand);

    expect(looked).toEqual([]);
    expect(copies().some(([, dest]) => dest.includes('thumb_thumb_'))).toBe(false);
  });

  // CopySource は x-amz-copy-source ヘッダとして送られる。素のキーを渡すと
  // 日本語やスペースを含む名前で Node.js が弾き、コピーが落ちる（PR #149）
  describe('複製元のエンコード', () => {
    // 全角スペースを含む実際のファイル名。ソースに素で書くと lint の
    // no-irregular-whitespace に当たるため、エスケープで表す
    const IDEOGRAPHIC_SPACE = '\u3000';
    const JP_NAME = `アラン${IDEOGRAPHIC_SPACE}ポートカスク1.jpeg`;
    it('日本語を含むファイル名でもヘッダに載せられる形にする', async () => {
      await callCopyImages({
        sourceKeys: [`${OWNER}/tmp/upload-1/${JP_NAME}`],
      });

      for (const source of rawCopySources()) {
        // ヘッダに入れられるのは ASCII の印字可能文字だけ
        expect(source).toMatch(/^[\x20-\x7E]*$/);
      }
    });

    it('区切りの / は残す（区画ごとにエンコードする）', async () => {
      await callCopyImages({
        sourceKeys: [`${OWNER}/tmp/upload-1/写真 1.jpeg`],
      });

      const [source] = rawCopySources();
      // バケット名 + キーの区画が / で繋がったまま
      expect(source.startsWith('dev-sakekasu-images/')).toBe(true);
      expect(source.split('/')).toHaveLength(5);
      // 空白はエンコードされている
      expect(source).not.toContain(' ');
      expect(decodeURIComponent(source)).toBe(
        `dev-sakekasu-images/${OWNER}/tmp/upload-1/写真 1.jpeg`,
      );
    });

    it('複製先のキーはエンコードしない（SDK が処理する）', async () => {
      const result = await callCopyImages({
        sourceKeys: [`${OWNER}/tmp/upload-1/${JP_NAME}`],
      });

      expect(result).toEqual([`${OWNER}/drinking/${RECORD_ID}/${JP_NAME}`]);
    });
  });

  // 複製先に同名の画像が既にあると、実体だけが入れ替わって記録は同じキーを
  // 指したまま。画面では気づけない（PR #146 の 3 巡目レビュー指摘）
  it('複製先に同名のファイルがあれば連番で避ける', async () => {
    sendMock.mockImplementation(async (command: unknown) => {
      if (command instanceof FakeListObjectsV2Command) {
        return {
          Contents: [
            { Key: `${OWNER}/drinking/${RECORD_ID}/photo.jpg` },
            { Key: `${OWNER}/drinking/${RECORD_ID}/thumb_photo.jpg` },
          ],
        };
      }
      return {};
    });

    const result = await callCopyImages({
      sourceKeys: [`${OWNER}/purchase/rec-1/photo.jpg`],
    });

    // 既存の photo.jpg を上書きしない
    expect(result).toEqual([`${OWNER}/drinking/${RECORD_ID}/photo-2.jpg`]);
    expect(copies().some(([, dest]) => dest.endsWith('/photo.jpg'))).toBe(false);
  });

  it('複製先が空なら従来どおりの名前を使う', async () => {
    sendMock.mockImplementation(async (command: unknown) => {
      if (command instanceof FakeListObjectsV2Command) {
        return { Contents: [] };
      }
      return {};
    });

    const result = await callCopyImages({
      sourceKeys: [`${OWNER}/purchase/rec-1/photo.jpg`],
    });

    expect(result).toEqual([`${OWNER}/drinking/${RECORD_ID}/photo.jpg`]);
  });

  it('空の配列を渡したら何も複製しない', async () => {
    expect(await callCopyImages({ sourceKeys: [] })).toEqual([]);
    expect(copies()).toEqual([]);
  });

  // 他人の画像を自分の記録へ引き込めてはいけない
  it('他人のキーが混ざっていたら複製せずに失敗させる', async () => {
    await expect(
      callCopyImages({
        sourceKeys: [`${OWNER}/purchase/rec-1/a.jpg`, `${VICTIM}/purchase/rec-9/secret.jpg`],
      }),
    ).rejects.toThrow('Unauthorized');

    expect(copies()).toEqual([]);
  });

  it('identity が無ければ複製しない', async () => {
    await expect(
      callCopyImages({ sourceKeys: [`${OWNER}/purchase/rec-1/a.jpg`], sub: null }),
    ).rejects.toThrow('Unauthorized: missing identity');

    expect(copies()).toEqual([]);
  });

  // recordType / recordId をそのままキーに埋めると、階層を細工して
  // 他人の領域や想定外の位置へ書き込める
  it.each([
    ['recordType が想定外', { recordType: 'admin' }],
    ['recordType に階層が入る', { recordType: '../purchase' }],
    ['recordId が UUID でない', { recordId: 'not-a-uuid' }],
    ['recordId に階層が入る', { recordId: `../../${VICTIM}/purchase/rec-9` }],
  ])('%s の場合は複製しない', async (_label, override) => {
    await expect(
      callCopyImages({ sourceKeys: [`${OWNER}/purchase/rec-1/a.jpg`], ...override }),
    ).rejects.toThrow();

    expect(copies()).toEqual([]);
  });

  it('上限を超える枚数は複製しない', async () => {
    const sourceKeys = Array.from(
      { length: 6 },
      (_, i) => `${OWNER}/purchase/rec-1/${i}.jpg`,
    );

    await expect(callCopyImages({ sourceKeys })).rejects.toThrow('Too many images');
    expect(copies()).toEqual([]);
  });

  // `/` で終わるキーだとファイル名が空になり、複製先がフォルダを指すキーになる。
  // 記録には中身の無いキーが残り、画像が出ないまま気づけない
  it.each([
    ['スラッシュで終わるキー', `${OWNER}/purchase/rec-1/`],
    ['ファイル名が .. のキー', `${OWNER}/purchase/rec-1/..`],
  ])('%s は複製しない', async (_label, sourceKey) => {
    await expect(callCopyImages({ sourceKeys: [sourceKey] })).rejects.toThrow('Invalid fileName');
    expect(copies()).toEqual([]);
  });

  // すべての例外を「無い」と扱うと、スロットリングや権限エラーでも
  // サムネイルを黙って飛ばし、原画だけが複製された状態に気づけない
  it('サムネイルの確認が 404 以外で失敗したら、黙って飛ばさず落とす', async () => {
    sendMock.mockImplementation(async (command: unknown) => {
      if (command instanceof FakeHeadObjectCommand) {
        const error = new Error('SlowDown');
        error.name = 'SlowDown';
        throw error;
      }
      return {};
    });

    await expect(
      callCopyImages({ sourceKeys: [`${OWNER}/purchase/rec-1/a.jpg`] }),
    ).rejects.toThrow('SlowDown');
  });

  it('購入記録どうしの複製もできる', async () => {
    const result = await callCopyImages({
      sourceKeys: [`${OWNER}/drinking/rec-1/a.jpg`],
      recordType: 'purchase',
    });

    expect(result).toEqual([`${OWNER}/purchase/${RECORD_ID}/a.jpg`]);
  });
});

// アップロード側も同じ材料でキーを組み立てる。片方だけ検証しても穴は塞がらない
describe('generateUploadUrl のキー検証', () => {
  beforeEach(() => {
    sendMock.mockReset();
    thumbnailsExist();
  });

  async function callGenerateUploadUrl(overrides: Record<string, unknown>) {
    return handler({
      info: { fieldName: 'generateUploadUrl' },
      arguments: {
        recordType: 'purchase',
        recordId: RECORD_ID,
        contentType: 'image/jpeg',
        fileName: 'a.jpg',
        fileSize: 1000,
        ...overrides,
      },
      identity: { sub: OWNER },
    } as Parameters<typeof handler>[0]);
  }

  it('正しい引数なら発行できる', async () => {
    const result = await callGenerateUploadUrl({});

    expect(result).toMatchObject({ key: `${OWNER}/purchase/${RECORD_ID}/a.jpg` });
  });

  it.each([
    ['recordType が想定外', { recordType: 'admin' }],
    ['recordType に階層が入る', { recordType: '../drinking' }],
    ['recordId が UUID でない', { recordId: 'not-a-uuid' }],
    ['recordId に階層が入る', { recordId: `../../${VICTIM}/purchase/rec-9` }],
    ['fileName に階層が入る', { fileName: '../../evil.jpg' }],
    ['fileName が ..', { fileName: '..' }],
  ])('%s の場合は発行しない', async (_label, override) => {
    await expect(callGenerateUploadUrl(override)).rejects.toThrow();
  });
});
