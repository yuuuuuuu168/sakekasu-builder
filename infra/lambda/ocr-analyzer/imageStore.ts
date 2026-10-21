// ラベル画像の取り出し方。持ち主の照合と、S3 からの読み出しを受け持つ。
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { assertOwnedKey } from '../shared/owner';
import { assertStoredImageFitsBedrockLimit } from './imageValidation.js';

const s3Client = new S3Client({});

const BUCKET_NAME = process.env.BUCKET_NAME!;

/**
 * imageKey のプレフィックスがユーザーの sub と一致するか検証する。
 * 不一致の場合はエラーをスローする。
 */
export function validateImageKeyAccess(sub: string, imageKey: string): void {
  assertOwnedKey(sub, imageKey);
}

/** S3 から取り出した画像。中身はまだ確かめていない */
export interface StoredImage {
  bytes: Uint8Array;
  contentType: string | undefined;
}

/**
 * 画像を S3 から順に取り出す。持ち主の照合は呼び出し側で済ませておく。
 *
 * 大きすぎるものは本体を読む前に落とす（`assertStoredImageFitsBedrockLimit()`）
 */
export async function fetchStoredImages(imageKeys: string[]): Promise<StoredImage[]> {
  const stored: StoredImage[] = [];
  for (const [index, key] of imageKeys.entries()) {
    let s3Response;
    try {
      s3Response = await s3Client.send(
        new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
        }),
      );
    } catch {
      throw new Error('Failed to retrieve image from storage');
    }

    // 大きすぎれば本体を読まずに落とす。取得の失敗と混同しないよう
    // 上の catch の外で投げる。読まない本体は閉じて接続を返す
    try {
      assertStoredImageFitsBedrockLimit(index, s3Response.ContentLength);
    } catch (error) {
      (s3Response.Body as { destroy?: () => void } | undefined)?.destroy?.();
      throw error;
    }

    try {
      stored.push({
        bytes: await s3Response.Body!.transformToByteArray(),
        contentType: s3Response.ContentType,
      });
    } catch {
      throw new Error('Failed to retrieve image from storage');
    }
  }
  return stored;
}
