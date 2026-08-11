// generateUploadUrl のキー組み立てと一時領域の扱い。
//
// OCR は記録の作成前に画像をアップロードするため、フォームを保存せずに離れた
// 画像がどこからも参照されないまま残る。置き場を tmp 区画に分け、タグを付けて
// S3 のライフサイクルで自動削除する（Issue #140）。タグが付かなければ孤児は
// 消えず、逆に記録用の画像にタグが付けば 1 日で消える。どちらも静かに壊れるので
// ここで取り決めを固定する。

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSignedUrlMock = vi.fn(async () => 'https://example.invalid/signed');

class FakePutObjectCommand {
  constructor(
    public input: { Bucket: string; Key: string; ContentType: string; Tagging?: string },
  ) {}
}

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = vi.fn();
  },
  PutObjectCommand: FakePutObjectCommand,
  GetObjectCommand: class {
    constructor(public input: unknown) {}
  },
  DeleteObjectCommand: class {
    constructor(public input: unknown) {}
  },
  CopyObjectCommand: class {
    constructor(public input: unknown) {}
  },
  HeadObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: getSignedUrlMock,
}));

process.env.BUCKET_NAME = 'dev-sakekasu-images';

const { handler } = await import('../index.js');

const OWNER = '11111111-1111-1111-1111-111111111111';
const RECORD_ID = '33333333-3333-3333-3333-333333333333';

async function callGenerateUploadUrl(args: {
  recordType?: string;
  recordId?: string;
  contentType?: string;
  fileName?: string;
  temporary?: boolean;
  thumbnail?: boolean;
}): Promise<{ uploadUrl: string; key: string }> {
  const result = await handler({
    info: { fieldName: 'generateUploadUrl' },
    arguments: {
      recordType: args.recordType ?? 'purchase',
      recordId: args.recordId ?? RECORD_ID,
      contentType: args.contentType ?? 'image/jpeg',
      fileName: args.fileName ?? 'a.jpg',
      ...(args.temporary === undefined ? {} : { temporary: args.temporary }),
      ...(args.thumbnail === undefined ? {} : { thumbnail: args.thumbnail }),
    },
    identity: { sub: OWNER },
  } as Parameters<typeof handler>[0]);
  return result as { uploadUrl: string; key: string };
}

/** 署名に渡された PutObjectCommand の入力 */
function signedPut(): FakePutObjectCommand['input'] {
  const command = getSignedUrlMock.mock.calls[0][1] as unknown as FakePutObjectCommand;
  return command.input;
}

describe('generateUploadUrl', () => {
  beforeEach(() => {
    getSignedUrlMock.mockClear();
  });

  it('記録に紐づく画像は記録種別のキーに置き、タグを付けない', async () => {
    const { key } = await callGenerateUploadUrl({});

    expect(key).toBe(`${OWNER}/purchase/${RECORD_ID}/a.jpg`);
    // ライフサイクルのタグが付くと、記録の画像が 1 日で消える
    expect(signedPut().Tagging).toBeUndefined();
  });

  it('temporary を渡さない既存の呼び出しは従来どおり', async () => {
    const { key } = await callGenerateUploadUrl({ temporary: undefined });

    expect(key).toBe(`${OWNER}/purchase/${RECORD_ID}/a.jpg`);
    expect(signedPut().Tagging).toBeUndefined();
  });

  it('temporary なら tmp 区画へ置く', async () => {
    const { key } = await callGenerateUploadUrl({ temporary: true });

    // 所有者チェックは先頭の {sub}/ を見るので、この形なら検証を変えずに済む
    expect(key).toBe(`${OWNER}/tmp/${RECORD_ID}/a.jpg`);
    expect(signedPut().Key).toBe(`${OWNER}/tmp/${RECORD_ID}/a.jpg`);
  });

  it('temporary なら削除対象のタグを署名に含める', async () => {
    await callGenerateUploadUrl({ temporary: true });

    // プレフィックスでは絞れないため、ライフサイクルはこのタグで対象を決める
    expect(signedPut().Tagging).toBe('lifecycle=temporary');
  });

  it('temporary でも recordId の形式は検証する', async () => {
    await expect(
      callGenerateUploadUrl({ temporary: true, recordId: '../other' }),
    ).rejects.toThrow('Invalid recordId');
  });

  it('temporary でもファイル名の区切り文字は弾く', async () => {
    await expect(
      callGenerateUploadUrl({ temporary: true, fileName: 'a/b.jpg' }),
    ).rejects.toThrow('Invalid fileName');
  });

  it('temporary でも許可した Content-Type だけを通す', async () => {
    await expect(
      callGenerateUploadUrl({ temporary: true, contentType: 'text/html' }),
    ).rejects.toThrow('Invalid contentType');
  });

  // tmp は Lambda が決める区画で、呼び出し側が recordType として指定するものではない
  it('recordType に tmp を指定しても記録種別として通らない', async () => {
    await expect(callGenerateUploadUrl({ recordType: 'tmp' })).rejects.toThrow(
      'Invalid recordType',
    );
  });

  // `thumb_` は原画から導出するサムネイルのために予約している。
  // 原画としてこの名前を使えると、同じ記録にある別の画像のサムネイルを
  // 原寸で上書きできてしまう（PR #144 の Security Agent レビュー指摘）
  describe('サムネイルの予約プレフィックス', () => {
    it('原画のファイル名が thumb_ で始まる場合は弾く', async () => {
      await expect(
        callGenerateUploadUrl({ fileName: 'thumb_photo.jpg' }),
      ).rejects.toThrow('must not start with thumb_');
    });

    it('一時領域でも同じく弾く', async () => {
      await expect(
        callGenerateUploadUrl({ fileName: 'thumb_photo.jpg', temporary: true }),
      ).rejects.toThrow('must not start with thumb_');
    });

    it('サムネイルのキーはサーバー側で導出する', async () => {
      const { key } = await callGenerateUploadUrl({
        fileName: 'photo.jpg',
        thumbnail: true,
      });

      expect(key).toBe(`${OWNER}/purchase/${RECORD_ID}/thumb_photo.jpg`);
    });

    it('一時領域のサムネイルも同じ規則で導出する', async () => {
      const { key } = await callGenerateUploadUrl({
        fileName: 'photo.jpg',
        thumbnail: true,
        temporary: true,
      });

      expect(key).toBe(`${OWNER}/tmp/${RECORD_ID}/thumb_photo.jpg`);
    });

    // クライアントが thumb_ 付きの名前を組み立てて送る余地を残さない
    it('サムネイル指定でも thumb_ 始まりの名前は受け取らない', async () => {
      await expect(
        callGenerateUploadUrl({ fileName: 'thumb_photo.jpg', thumbnail: true }),
      ).rejects.toThrow('must not start with thumb_');
    });

    it('名前の途中に thumb_ があるだけなら通す', async () => {
      const { key } = await callGenerateUploadUrl({ fileName: 'my_thumb_photo.jpg' });

      expect(key).toBe(`${OWNER}/purchase/${RECORD_ID}/my_thumb_photo.jpg`);
    });
  });

  it('identity が無い呼び出しは弾く', async () => {
    await expect(
      handler({
        info: { fieldName: 'generateUploadUrl' },
        arguments: {
          recordType: 'purchase',
          recordId: RECORD_ID,
          contentType: 'image/jpeg',
          fileName: 'a.jpg',
          temporary: true,
        },
        identity: null,
      } as Parameters<typeof handler>[0]),
    ).rejects.toThrow('Unauthorized');
  });
});
