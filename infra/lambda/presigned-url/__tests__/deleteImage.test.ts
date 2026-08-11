// deleteImage の所有者チェック。
//
// 削除パイプラインが渡す imageKey は、削除した記録に入っていた値でしかない。
// 作成時に他人のキーを書いた記録を自分で作って削除すると、他人の画像を
// 消せてしまう経路があった。ここはその穴を塞いだことを固定する。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendMock = vi.fn();

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
    constructor(public input: { Bucket: string; Key: string }) {}
  },
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://example.invalid/signed'),
}));

process.env.BUCKET_NAME = 'dev-sakekasu-images';

const { handler } = await import('../index.js');

const OWNER = '11111111-1111-1111-1111-111111111111';
const VICTIM = '22222222-2222-2222-2222-222222222222';

/** deleteImage を1回呼ぶ（パイプラインからの呼び出し形式に合わせる） */
async function callDeleteImage(args: {
  imageKey?: string;
  imageKeys?: string[];
  sub?: string;
}) {
  return handler({
    info: { fieldName: 'deleteImage' },
    arguments: { imageKey: args.imageKey, imageKeys: args.imageKeys },
    identity: { sub: args.sub ?? OWNER },
  } as Parameters<typeof handler>[0]);
}

/** 実際に DeleteObject が呼ばれたキーの一覧 */
function deletedKeys(): string[] {
  return sendMock.mock.calls.map((call) => (call[0] as { input: { Key: string } }).input.Key);
}

describe('deleteImage の所有者チェック', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // サムネイルは記録に保存されず原画から導出する兄弟キー。記録が持つキーだけを
  // 消していたため、原画は消えたのにサムネイルが残っていた（Issue #132）
  it('自分のキーは原画とサムネイルの両方を削除する', async () => {
    const result = await callDeleteImage({ imageKey: `${OWNER}/purchase/rec-1/photo.jpg` });

    expect(deletedKeys().sort()).toEqual([
      `${OWNER}/purchase/rec-1/photo.jpg`,
      `${OWNER}/purchase/rec-1/thumb_photo.jpg`,
    ]);
    expect(result).toMatchObject({ success: true });
  });

  // サムネイルが未生成の記録もある。S3 は無いキーの削除もエラーにしないので、
  // 存在を確かめずに消してよい（確認の往復ぶん速い）
  it('サムネイルの有無を確かめずに消しにいく', async () => {
    await callDeleteImage({ imageKey: `${OWNER}/purchase/rec-1/photo.jpg` });

    const heads = sendMock.mock.calls.filter(
      (call) => call[0]?.constructor?.name?.includes('Head'),
    );
    expect(heads).toEqual([]);
  });

  // 消し残しは ImageDeleteFailCount のアラームで拾う。サムネイルだけ失敗した
  // 場合も「消したはずの画像が残る」ので、同じように失敗として扱う
  it('サムネイルの削除に失敗したら失敗として返す', async () => {
    sendMock.mockImplementation(async (command: { input: { Key: string } }) => {
      if (command.input.Key.includes('thumb_')) {
        throw new Error('S3 unavailable');
      }
      return {};
    });

    const result = await callDeleteImage({ imageKey: `${OWNER}/purchase/rec-1/photo.jpg` });

    expect(result).toMatchObject({ success: true, imageDeleteFailed: true });
  });

  // アップロードのファイル名に `thumb_` を使うことは禁じていない
  // （クライアントはサムネイルをその名前で上げるため）。記録がそれを直接
  // 持っている場合に導出をかけると、在りもしない二重プレフィックスのキーを
  // 消しにいって成功ログだけが増える
  it('記録が thumb_ 始まりのキーを持つ場合、二重に導出しない', async () => {
    await callDeleteImage({ imageKey: `${OWNER}/purchase/rec-1/thumb_photo.jpg` });

    expect(deletedKeys()).toEqual([`${OWNER}/purchase/rec-1/thumb_photo.jpg`]);
    expect(deletedKeys().some((key) => key.includes('thumb_thumb_'))).toBe(false);
  });

  it('他人のキーは削除しない', async () => {
    const result = await callDeleteImage({ imageKey: `${VICTIM}/purchase/rec-9/photo.jpg` });

    expect(sendMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ imageDeleteFailed: true });
  });

  it('自分のキーと他人のキーが混ざっていても、自分のぶんだけ削除する', async () => {
    await callDeleteImage({
      imageKeys: [
        `${OWNER}/purchase/rec-1/a.jpg`,
        `${VICTIM}/purchase/rec-9/b.jpg`,
        `${OWNER}/purchase/rec-1/c.jpg`,
      ],
    });

    expect(deletedKeys().sort()).toEqual([
      `${OWNER}/purchase/rec-1/a.jpg`,
      `${OWNER}/purchase/rec-1/c.jpg`,
      `${OWNER}/purchase/rec-1/thumb_a.jpg`,
      `${OWNER}/purchase/rec-1/thumb_c.jpg`,
    ]);
    // 他人のキーはサムネイル側にも手を出さない
    expect(deletedKeys().some((key) => key.startsWith(VICTIM))).toBe(false);
  });

  it('sub の前方一致だけで通さない（別人の sub が自分の sub で始まる場合）', async () => {
    // 区切りの / まで含めて見ていないと、sub が前方一致する別人を通してしまう
    await callDeleteImage({ imageKey: `${OWNER}-other/purchase/rec-9/photo.jpg` });

    expect(sendMock).not.toHaveBeenCalled();
  });

  it('identity が無い呼び出しは拒否する', async () => {
    await expect(
      handler({
        info: { fieldName: 'deleteImage' },
        arguments: { imageKey: `${OWNER}/purchase/rec-1/photo.jpg` },
      } as Parameters<typeof handler>[0]),
    ).rejects.toThrow('Unauthorized');

    expect(sendMock).not.toHaveBeenCalled();
  });

  // 削除パイプラインは画像を持たない記録でも arguments を空にして呼ぶ。
  // 引数を見る前に認可するので、identity が無ければ success を返さない
  it('削除対象が無くても identity が無ければ拒否する', async () => {
    await expect(
      handler({
        info: { fieldName: 'deleteImage' },
        arguments: {},
      } as Parameters<typeof handler>[0]),
    ).rejects.toThrow('Unauthorized');

    expect(sendMock).not.toHaveBeenCalled();
  });

  it('削除対象が無いときは何もしない', async () => {
    const result = await callDeleteImage({});

    expect(sendMock).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('拒否したことはログに残すが、他人のキーは書かない', async () => {
    const spy = vi.spyOn(console, 'error');

    await callDeleteImage({ imageKey: `${VICTIM}/purchase/rec-9/photo.jpg` });

    const logged = spy.mock.calls.flat().join(' ');
    // 監視スタックのメトリクスフィルター（level=ERROR かつ action=deleteImage）に拾わせる
    expect(logged).toContain('"level":"ERROR"');
    expect(logged).toContain('"action":"deleteImage"');
    // 他人の sub を自分のログへ持ち込まない
    expect(logged).not.toContain(VICTIM);
  });

  // Issue #127: ロググループは無期限で残るため、成功ログにも sub を出さない。
  // ただし削除失敗の調査で recordId は要るので、sub の部分だけを落とす
  it('成功ログに自分の sub を書かない（recordId は残す）', async () => {
    const spy = vi.spyOn(console, 'log');

    await callDeleteImage({ imageKey: `${OWNER}/purchase/rec-1/photo.jpg` });

    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).toContain('"result":"success"');
    expect(logged).not.toContain(OWNER);
    // 調査に必要な部分は残っている
    expect(logged).toContain('purchase/rec-1/photo.jpg');
  });

  it('削除失敗のログにも自分の sub を書かない', async () => {
    sendMock.mockRejectedValue(new Error('S3 unavailable'));
    const spy = vi.spyOn(console, 'error');

    const result = await callDeleteImage({ imageKey: `${OWNER}/purchase/rec-1/photo.jpg` });

    const logged = spy.mock.calls.flat().join(' ');
    expect(result).toMatchObject({ imageDeleteFailed: true });
    // 監視スタックのメトリクスフィルターに拾わせる形は保つ
    expect(logged).toContain('"level":"ERROR"');
    expect(logged).toContain('"action":"deleteImage"');
    expect(logged).not.toContain(OWNER);
    expect(logged).toContain('purchase/rec-1/photo.jpg');
  });
});
