// getDownloadUrls（複数キーの一括署名）の振る舞い。
//
// 一覧は画像の数だけ getDownloadUrl を呼んでいて、アカウントの Lambda 同時実行枠
// （10）を使い切って大半がスロットリングされ、URL を取れなかった記録の画像が
// 表示されなくなっていた。まとめて署名する経路の取り決めをここで固定する。

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSignedUrlMock = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = vi.fn();
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
  GetObjectCommand: class {
    constructor(public input: { Bucket: string; Key: string }) {}
  },
  DeleteObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => getSignedUrlMock(...args),
}));

process.env.BUCKET_NAME = 'dev-sakekasu-images';

const { handler } = await import('../index.js');

const OWNER = '11111111-1111-1111-1111-111111111111';
const VICTIM = '22222222-2222-2222-2222-222222222222';

/** getDownloadUrls を1回呼ぶ */
async function callGetDownloadUrls(keys: string[], sub = OWNER): Promise<string[]> {
  const result = await handler({
    info: { fieldName: 'getDownloadUrls' },
    arguments: { keys },
    identity: { sub },
  } as Parameters<typeof handler>[0]);
  return result as string[];
}

describe('getDownloadUrls', () => {
  beforeEach(() => {
    getSignedUrlMock.mockReset();
    // 署名対象のキーがそのまま分かる形で返す
    getSignedUrlMock.mockImplementation(
      async (_client: unknown, command: { input: { Key: string } }) =>
        `https://example.invalid/${command.input.Key}`,
    );
  });

  // フロントはインデックスで突き合わせる。詰めたり並べ替えたりすると
  // 別の記録の画像が表示される
  it('渡した keys と同じ並び・同じ件数で URL を返す', async () => {
    const keys = [
      `${OWNER}/purchase/rec-1/a.jpg`,
      `${OWNER}/purchase/rec-2/b.jpg`,
      `${OWNER}/drinking/rec-3/c.jpg`,
    ];

    const urls = await callGetDownloadUrls(keys);

    expect(urls).toEqual(keys.map((key) => `https://example.invalid/${key}`));
  });

  it('空配列を渡したら署名せずに空配列を返す', async () => {
    expect(await callGetDownloadUrls([])).toEqual([]);
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  // 他人の画像を1件でも混ぜて取れてはいけない（getDownloadUrl と同じ扱い）
  it('他人のキーが1件でも混ざっていたら全体を失敗させる', async () => {
    await expect(
      callGetDownloadUrls([
        `${OWNER}/purchase/rec-1/a.jpg`,
        `${VICTIM}/purchase/rec-9/secret.jpg`,
      ]),
    ).rejects.toThrow('Unauthorized');
  });

  // sub の前方一致だけで通すと、別ユーザーの sub が自分の sub で始まる場合に
  // 抜けられる。区切りの / まで含めて一致させている
  it('sub が前方一致するだけの他人のキーを弾く', async () => {
    await expect(
      callGetDownloadUrls([`${OWNER}-other/purchase/rec-1/a.jpg`]),
    ).rejects.toThrow('Unauthorized');
  });

  it('上限を超える件数は弾く', async () => {
    const keys = Array.from({ length: 101 }, (_, i) => `${OWNER}/purchase/rec-1/${i}.jpg`);

    await expect(callGetDownloadUrls(keys)).rejects.toThrow('Too many keys');
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it('上限ちょうどの件数は通す', async () => {
    const keys = Array.from({ length: 100 }, (_, i) => `${OWNER}/purchase/rec-1/${i}.jpg`);

    expect(await callGetDownloadUrls(keys)).toHaveLength(100);
  });

  // 単体版も残す（後方互換）。まとめ版と同じ所有者チェックが効くこと
  it('getDownloadUrl は従来どおり1件を返し、他人のキーを弾く', async () => {
    const single = await handler({
      info: { fieldName: 'getDownloadUrl' },
      arguments: { key: `${OWNER}/purchase/rec-1/a.jpg` },
      identity: { sub: OWNER },
    } as Parameters<typeof handler>[0]);

    expect(single).toBe(`https://example.invalid/${OWNER}/purchase/rec-1/a.jpg`);

    await expect(
      handler({
        info: { fieldName: 'getDownloadUrl' },
        arguments: { key: `${VICTIM}/purchase/rec-9/secret.jpg` },
        identity: { sub: OWNER },
      } as Parameters<typeof handler>[0]),
    ).rejects.toThrow('Unauthorized');
  });
});
