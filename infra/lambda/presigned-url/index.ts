import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({});

const BUCKET_NAME = process.env.BUCKET_NAME!;
const UPLOAD_EXPIRY = Number(process.env.UPLOAD_EXPIRY || '300');
const DOWNLOAD_EXPIRY = Number(process.env.DOWNLOAD_EXPIRY || '3600');

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png'];

interface AppSyncEvent {
  info: {
    fieldName: string;
  };
  arguments: {
    recordType?: string;
    recordId?: string;
    contentType?: string;
    fileName?: string;
    key?: string;
    imageKey?: string;
  };
  identity: {
    sub: string;
  };
  source?: {
    imageKey?: string | null;
  };
}

interface UploadUrlResponse {
  uploadUrl: string;
  key: string;
}

export async function handler(event: AppSyncEvent): Promise<UploadUrlResponse | string | { success: boolean }> {
  const { fieldName } = event.info;

  switch (fieldName) {
    case 'generateUploadUrl':
      return generateUploadUrl(event);
    case 'getDownloadUrl':
      return getDownloadUrl(event);
    case 'deleteImage':
      return deleteImage(event);
    default:
      throw new Error(`Unknown field: ${fieldName}`);
  }
}

async function generateUploadUrl(event: AppSyncEvent): Promise<UploadUrlResponse> {
  const { recordType, recordId, contentType, fileName } = event.arguments;
  const ownerSub = event.identity.sub;

  if (!recordType || !recordId || !contentType || !fileName) {
    throw new Error('Missing required arguments: recordType, recordId, contentType, fileName');
  }

  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    throw new Error(`Invalid contentType: ${contentType}. Allowed: ${ALLOWED_CONTENT_TYPES.join(', ')}`);
  }

  const key = `${ownerSub}/${recordType}/${recordId}/${fileName}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: UPLOAD_EXPIRY,
  });

  return { uploadUrl, key };
}

async function getDownloadUrl(event: AppSyncEvent): Promise<string> {
  const { key } = event.arguments;
  const ownerSub = event.identity.sub;

  if (!key) {
    throw new Error('Missing required argument: key');
  }

  // キーのプレフィックスがリクエストユーザーの sub と一致するか検証
  if (!key.startsWith(`${ownerSub}/`)) {
    throw new Error('Unauthorized: cannot access other user\'s images');
  }

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const downloadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: DOWNLOAD_EXPIRY,
  });

  return downloadUrl;
}


async function deleteImage(event: AppSyncEvent): Promise<{ success: boolean; imageDeleteFailed?: boolean }> {
  // Pipeline リゾルバーから prev.result 経由で imageKey を受け取る
  const imageKey = event.arguments?.imageKey || event.source?.imageKey;

  if (!imageKey) {
    // imageKey がない場合はスキップ（正常系）
    return { success: true };
  }

  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: imageKey,
    });

    await s3Client.send(command);
    console.log(JSON.stringify({ level: 'INFO', action: 'deleteImage', imageKey, result: 'success' }));
    return { success: true };
  } catch (error) {
    // 画像削除失敗時はレコード削除自体は成功扱いとするが、警告を残す
    console.error(JSON.stringify({
      level: 'ERROR',
      action: 'deleteImage',
      imageKey,
      result: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    return { success: true, imageDeleteFailed: true };
  }
}
