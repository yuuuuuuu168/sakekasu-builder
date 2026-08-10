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
    imageKeys?: string[];
  };
  identity: {
    sub: string;
  };
  source?: {
    imageKey?: string | null;
    imageKeys?: string[] | null;
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
  // Pipeline リゾルバーから imageKey(単一) と imageKeys(複数) の両方を処理
  const imageKey = event.arguments?.imageKey || event.source?.imageKey;
  const imageKeys = event.arguments?.imageKeys || event.source?.imageKeys;
  const ownerSub = event.identity?.sub;

  // 削除対象のキーを統合
  const requestedKeys: string[] = [];
  if (imageKeys && imageKeys.length > 0) {
    requestedKeys.push(...imageKeys);
  } else if (imageKey) {
    requestedKeys.push(imageKey);
  }

  if (requestedKeys.length === 0) {
    return { success: true };
  }

  if (!ownerSub) {
    throw new Error('Unauthorized: missing identity');
  }

  let hasFailure = false;

  // 自分のキーだけを消す。
  //
  // ここに来る imageKey は削除した記録に入っていた値で、記録の所有者とは
  // 別に検証されていない。作成時に他人のキーを書いた記録を自分で作って
  // 削除すると、他人の画像を消せてしまう。getDownloadUrl と同じ形で塞ぐ。
  //
  // 弾いた場合も削除処理自体は続ける。ここで例外にすると、記録は消えている
  // のに削除が失敗したと返ることになり、利用者から見た状態が食い違う
  const keysToDelete = requestedKeys.filter((key) => {
    if (key.startsWith(`${ownerSub}/`)) {
      return true;
    }
    hasFailure = true;
    // 他人の sub を自分のログへ書かないよう、キーは出さない。
    // このログは ImageDeleteFailCount のメトリクスフィルターに拾われ、
    // 監視スタックのアラーム経由で Slack に出る
    console.error(
      JSON.stringify({
        level: 'ERROR',
        action: 'deleteImage',
        result: 'unauthorized',
        reason: 'key does not belong to the requester',
      }),
    );
    return false;
  });

  if (keysToDelete.length === 0) {
    return { success: true, imageDeleteFailed: hasFailure };
  }

  await Promise.all(
    keysToDelete.map(async (key) => {
      try {
        const command = new DeleteObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
        });
        await s3Client.send(command);
        console.log(JSON.stringify({ level: 'INFO', action: 'deleteImage', imageKey: key, result: 'success' }));
      } catch (error) {
        hasFailure = true;
        console.error(JSON.stringify({
          level: 'ERROR',
          action: 'deleteImage',
          imageKey: key,
          result: 'failed',
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    })
  );

  return { success: true, imageDeleteFailed: hasFailure };
}
