import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { RekognitionClient, DetectTextCommand } from '@aws-sdk/client-rekognition';
import { extractSakeName } from './extractSakeName.js';

const s3Client = new S3Client({});
const rekognitionClient = new RekognitionClient({});

const BUCKET_NAME = process.env.BUCKET_NAME!;

interface AppSyncEvent {
  info: {
    fieldName: string;
  };
  arguments: {
    imageKey: string;
  };
  identity: {
    sub: string;
  };
}

interface OcrResult {
  sakeName: string | null;
  confidence: number;
  rawTexts: string[];
}

/**
 * imageKey のプレフィックスがユーザーの sub と一致するか検証する。
 * 不一致の場合はエラーをスローする。
 */
export function validateImageKeyAccess(sub: string, imageKey: string): void {
  if (!imageKey.startsWith(`${sub}/`)) {
    throw new Error("Unauthorized: cannot access other user's images");
  }
}

export async function handler(event: AppSyncEvent): Promise<OcrResult> {
  const { imageKey } = event.arguments;
  const { sub } = event.identity;

  // アクセス制御: imageKey プレフィックスと sub の照合
  validateImageKeyAccess(sub, imageKey);

  // S3 から画像を取得
  let imageBytes: Uint8Array;
  try {
    const s3Response = await s3Client.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: imageKey,
      }),
    );
    imageBytes = await s3Response.Body!.transformToByteArray();
  } catch {
    throw new Error('Failed to retrieve image from storage');
  }

  // Rekognition でテキスト検出
  let textDetections;
  try {
    const rekognitionResponse = await rekognitionClient.send(
      new DetectTextCommand({
        Image: {
          Bytes: imageBytes,
        },
      }),
    );
    textDetections = rekognitionResponse.TextDetections ?? [];
  } catch {
    throw new Error('OCR analysis failed');
  }

  // 銘柄名を抽出して返却
  const result = extractSakeName(
    textDetections.map((d) => ({
      DetectedText: d.DetectedText,
      Type: d.Type as 'LINE' | 'WORD' | undefined,
      Confidence: d.Confidence,
    })),
  );

  return {
    sakeName: result.sakeName,
    confidence: result.confidence,
    rawTexts: result.rawTexts,
  };
}
