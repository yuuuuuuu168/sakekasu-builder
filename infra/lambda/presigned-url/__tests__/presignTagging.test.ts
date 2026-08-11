// 署名済み URL がタグをどう運ぶかを、SDK の実物で確かめる。
//
// 他のテストは getSignedUrl をモックしているため、「PutObjectCommand に
// Tagging を渡した」ことしか見ていない。SDK がそれを URL のどこに置くかは
// 検証されず、PR #145 ではここを実機で確かめないまま「タグは署名対象ヘッダに
// 入る」と推測して実装し、本番の画像アップロードを 403 で全滅させた。
//
// 署名の計算はローカルで完結する（ネットワークも実在の認証情報も要らない）ので、
// SDK の挙動そのものをテストで固定できる。SDK の更新でこの前提が崩れたら、
// 本番ではなくここで落ちる。

import { describe, it, expect } from 'vitest';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({
  region: 'ap-northeast-1',
  // 署名計算だけを行うので実在しない値でよい
  credentials: { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret' },
});

const BUCKET = 'dev-sakekasu-images';
const KEY = 'sub/tmp/00000000-0000-4000-8000-000000000000/a.jpg';
const TAGGING = 'lifecycle=temporary';

async function presign(extra: Record<string, string> = {}): Promise<URL> {
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: KEY,
      ContentType: 'image/jpeg',
      ...extra,
    }),
    { expiresIn: 300 },
  );
  return new URL(url);
}

describe('署名済み URL とタグの関係', () => {
  it('Tagging はクエリパラメータとして URL に入る', async () => {
    const url = await presign({ Tagging: TAGGING });

    expect(url.searchParams.get('x-amz-tagging')).toBe(TAGGING);
  });

  // ここが崩れると「ヘッダで送らないと 403」に逆戻りする。
  // クライアントが x-amz-tagging を送らない前提の根拠がこれ
  it('Tagging は署名対象ヘッダに含まれない', async () => {
    const url = await presign({ Tagging: TAGGING });

    const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders') ?? '';
    expect(signedHeaders).not.toContain('x-amz-tagging');
  });

  it('Tagging を指定しなければクエリにも現れない', async () => {
    const url = await presign();

    expect(url.searchParams.get('x-amz-tagging')).toBeNull();
  });

  // タグの有無で署名が変わる = クエリが署名の計算に入っている。
  // つまりクライアントは URL をそのまま使うだけでタグが付く
  it('タグの有無で署名が変わる（クエリが署名に含まれている）', async () => {
    const withTag = await presign({ Tagging: TAGGING });
    const withoutTag = await presign();

    expect(withTag.searchParams.get('X-Amz-Signature')).not.toBe(
      withoutTag.searchParams.get('X-Amz-Signature'),
    );
  });
});
