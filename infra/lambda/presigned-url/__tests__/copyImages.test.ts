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

/** サムネイルが「ない」ものとして振る舞わせる */
function thumbnailsMissing(): void {
  sendMock.mockImplementation(async (command: unknown) => {
    if (command instanceof FakeHeadObjectCommand) {
      throw new Error('NotFound');
    }
    return {};
  });
}

/** 実際にコピーされた (コピー元 → コピー先) の一覧 */
function copies(): [string, string][] {
  return sendMock.mock.calls
    .map((call) => call[0])
    .filter((c): c is FakeCopyObjectCommand => c instanceof FakeCopyObjectCommand)
    .map((c) => [c.input.CopySource.replace('dev-sakekasu-images/', ''), c.input.Key]);
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

  it('購入記録どうしの複製もできる', async () => {
    const result = await callCopyImages({
      sourceKeys: [`${OWNER}/drinking/rec-1/a.jpg`],
      recordType: 'purchase',
    });

    expect(result).toEqual([`${OWNER}/purchase/${RECORD_ID}/a.jpg`]);
  });
});
