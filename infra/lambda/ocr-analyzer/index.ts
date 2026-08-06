import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { extractLabelInfo, type SakeCategory } from './extractLabelInfo.js';

const s3Client = new S3Client({});
const bedrockClient = new BedrockRuntimeClient({});

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
  category: SakeCategory | null;
  region: string | null;
  alcoholPercentage: number | null;
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
  let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
  try {
    const s3Response = await s3Client.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: imageKey,
      }),
    );
    imageBytes = await s3Response.Body!.transformToByteArray();

    // Content-Type から画像形式を判定
    const contentType = s3Response.ContentType ?? '';
    if (
      contentType === 'image/jpeg' ||
      contentType === 'image/png' ||
      contentType === 'image/gif' ||
      contentType === 'image/webp'
    ) {
      mediaType = contentType;
    }
  } catch {
    throw new Error('Failed to retrieve image from storage');
  }

  // 画像を Base64 エンコード
  const base64Image = Buffer.from(imageBytes).toString('base64');

  // Bedrock Claude Haiku でマルチモーダル解析
  const modelId = process.env.BEDROCK_MODEL_ID ?? 'jp.anthropic.claude-haiku-4-5-20251001-v1:0';
  const requestBody = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64Image,
            },
          },
          {
            type: 'text',
            text: `このお酒のラベル画像から以下の情報を抽出してください。
以下のJSON形式のみで返してください。読み取れない・判定できない項目はnullにしてください。

{"sakeName": "銘柄名" または null, "category": "カテゴリ" または null, "region": "産地" または null, "alcoholPercentage": 数値 または null}

各項目のルール:
- sakeName: 銘柄名のみ。製造者名（酒造、株式会社等）、容量（ml）、アルコール度数（%）は含めない
- category: 必ず次のいずれかの値: "NIHONSHU"（日本酒・清酒）, "BEER"（ビール・発泡酒）, "WINE"（ワイン・スパークリング）, "WHISKY"（ウイスキー）, "SHOCHU"（焼酎・泡盛）, "OTHER"（その他の酒類）
- region: 産地の都道府県名または国名（例: "山口県", "スコットランド"）。製造者の住所から判断してもよい
- alcoholPercentage: アルコール度数の数値のみ（例: 15.5）。%記号や「度」は含めない`,
          },
        ],
      },
    ],
  };

  let responseText: string;
  try {
    const response = await bedrockClient.send(
      new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(requestBody),
      }),
    );
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    responseText = responseBody.content[0].text;
    // デバッグ用: Bedrockのレスポンスをログ出力
    console.log('[OCR] Bedrock raw response:', responseText);
  } catch (err) {
    console.error('[OCR] Bedrock invocation error:', err);
    throw new Error('OCR analysis failed');
  }

  // ラベル情報を抽出して返却
  return extractLabelInfo(responseText);
}
