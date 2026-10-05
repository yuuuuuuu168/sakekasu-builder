// 署名済み URL が大きさをどう運ぶかを、SDK の実物で確かめる
// （Issue sakekasu-builder-archive#173）。
//
// generateUploadUrl.test.ts は getSignedUrl をモックしているため、
// 「PutObjectCommand に ContentLength を渡した」ことしか見ていない。
// それが署名対象ヘッダに入らなければ、URL を受け取った側は何バイトでも置ける。
// タグで一度これを推測で実装して本番を止めた（PR #147、presignTagging.test.ts）ので、
// ここも SDK の挙動そのものを固定する。署名の計算はローカルで完結する。

import { describe, it, expect } from 'vitest';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({
  region: 'ap-northeast-1',
  // 署名計算だけを行うので実在しない値でよい
  credentials: { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret' },
});

async function presign(extra: { ContentLength?: number; Tagging?: string } = {}): Promise<URL> {
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: 'dev-sakekasu-images',
      Key: 'sub/purchase/00000000-0000-4000-8000-000000000000/a.jpg',
      ContentType: 'image/jpeg',
      ...extra,
    }),
    { expiresIn: 300 },
  );
  return new URL(url);
}

function signedHeaders(url: URL): string[] {
  return (url.searchParams.get('X-Amz-SignedHeaders') ?? '').split(';');
}

describe('署名済み URL と大きさの関係', () => {
  // ここが崩れると、申告した大きさと違う本体でも置けるようになる
  it('ContentLength を渡すと content-length が署名対象ヘッダに入る', async () => {
    const url = await presign({ ContentLength: 1000 });

    expect(signedHeaders(url)).toContain('content-length');
  });

  it('大きさが違えば署名も変わる', async () => {
    const small = await presign({ ContentLength: 1000 });
    const large = await presign({ ContentLength: 1001 });

    expect(small.searchParams.get('X-Amz-Signature')).not.toBe(
      large.searchParams.get('X-Amz-Signature'),
    );
  });

  it('ContentLength を渡さなければ大きさは署名されない', async () => {
    const url = await presign();

    expect(signedHeaders(url)).not.toContain('content-length');
  });

  // 一時領域ではタグと大きさを両方渡す。タグがヘッダ側に移ると、
  // クライアントが送らない限り 403 になる（PR #147 の逆）
  it('大きさと併せても、タグはクエリに残り署名対象ヘッダには入らない', async () => {
    const url = await presign({ ContentLength: 1000, Tagging: 'lifecycle=temporary' });

    expect(url.searchParams.get('x-amz-tagging')).toBe('lifecycle=temporary');
    expect(signedHeaders(url)).not.toContain('x-amz-tagging');
    expect(signedHeaders(url)).toContain('content-length');
  });
});
