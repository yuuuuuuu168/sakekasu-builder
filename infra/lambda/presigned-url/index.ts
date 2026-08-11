import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({});

const BUCKET_NAME = process.env.BUCKET_NAME!;
const UPLOAD_EXPIRY = Number(process.env.UPLOAD_EXPIRY || '300');
const DOWNLOAD_EXPIRY = Number(process.env.DOWNLOAD_EXPIRY || '3600');

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png'];

/**
 * getDownloadUrls が 1 回で受け付けるキーの上限。
 *
 * 署名の生成自体はローカル計算だが、上限を置かないと巨大なリクエストで
 * 実行時間とレスポンスサイズが伸びる。フロント側は 50 件ずつに割って送る
 */
const MAX_DOWNLOAD_KEYS = 100;

/** サムネイルのファイル名に付けるプレフィックス（フロントの thumbnailKey.ts と揃える） */
const THUMBNAIL_PREFIX = 'thumb_';

/** 記録に添付できる画像の上限（フロントの useImageUpload と揃える） */
const MAX_IMAGES_PER_RECORD = 5;

/** キーに使える記録種別。任意の文字列を通すとキーの階層を細工できる */
const ALLOWED_RECORD_TYPES = ['purchase', 'drinking'];

/** recordId は UUID のみ。`/` や `..` を含む値でキーの位置をずらされないようにする */
const RECORD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    keys?: string[];
    sourceKeys?: string[];
    imageKey?: string;
    imageKeys?: string[];
  };
  // AppSync は USER_POOL 認証を既定にしているが、直接呼び出しや別の認証方式の
  // 経路では identity が入らないことがある。型でも入らない前提にしておく
  identity?: {
    sub?: string;
  } | null;
  source?: {
    imageKey?: string | null;
    imageKeys?: string[] | null;
  };
}

interface UploadUrlResponse {
  uploadUrl: string;
  key: string;
}

/** 原画キーから、その兄弟であるサムネイルキーを導出する（フロントと同じ規則） */
function toThumbnailKey(key: string): string {
  const separatorIndex = key.lastIndexOf('/');
  if (separatorIndex === -1) {
    return `${THUMBNAIL_PREFIX}${key}`;
  }
  return `${key.slice(0, separatorIndex + 1)}${THUMBNAIL_PREFIX}${key.slice(separatorIndex + 1)}`;
}

export async function handler(event: AppSyncEvent): Promise<UploadUrlResponse | string | string[] | { success: boolean }> {
  const { fieldName } = event.info;

  switch (fieldName) {
    case 'generateUploadUrl':
      return generateUploadUrl(event);
    case 'getDownloadUrl':
      return getDownloadUrl(event);
    case 'getDownloadUrls':
      return getDownloadUrls(event);
    case 'copyImages':
      return copyImages(event);
    case 'deleteImage':
      return deleteImage(event);
    default:
      throw new Error(`Unknown field: ${fieldName}`);
  }
}

/**
 * リクエスト元の sub を取り出す。identity が無い呼び出しは弾く。
 *
 * キーの所有者チェックは `${ownerSub}/` の前方一致で行うため、sub が
 * 空文字のまま通ると `/` で始まる任意のキーが一致してしまう。
 * identity が落ちる経路（直接呼び出しなど）でも素の TypeError にせず、
 * 認可エラーとして扱う
 */
function requireOwnerSub(event: AppSyncEvent): string {
  const ownerSub = event.identity?.sub;

  if (!ownerSub) {
    throw new Error('Unauthorized: missing identity');
  }

  return ownerSub;
}

/**
 * キーの階層に使う値を検証する。
 *
 * キーは `{sub}/{recordType}/{recordId}/{fileName}` で組み立てる。
 * 各要素をそのまま埋めると、区切り文字や `..` を混ぜて階層を細工できる。
 * 所有者の sub が先頭に付くので他人の領域には届かないが、
 * 自分の名前空間の中で想定外の位置に書けてしまう
 */
function assertRecordLocation(recordType: string, recordId: string): void {
  if (!ALLOWED_RECORD_TYPES.includes(recordType)) {
    throw new Error(`Invalid recordType: ${recordType}`);
  }

  if (!RECORD_ID_PATTERN.test(recordId)) {
    throw new Error('Invalid recordId');
  }
}

/** キーの末尾に使うファイル名を検証する */
function assertFileName(fileName: string): void {
  if (!fileName || fileName.includes('/') || fileName === '.' || fileName === '..') {
    throw new Error(`Invalid fileName: ${fileName}`);
  }
}

async function generateUploadUrl(event: AppSyncEvent): Promise<UploadUrlResponse> {
  const { recordType, recordId, contentType, fileName } = event.arguments;
  const ownerSub = requireOwnerSub(event);

  if (!recordType || !recordId || !contentType || !fileName) {
    throw new Error('Missing required arguments: recordType, recordId, contentType, fileName');
  }

  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    throw new Error(`Invalid contentType: ${contentType}. Allowed: ${ALLOWED_CONTENT_TYPES.join(', ')}`);
  }

  assertRecordLocation(recordType, recordId);
  assertFileName(fileName);

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

/** 1 件分のダウンロード用 Presigned URL を作る（所有者チェック込み） */
async function signDownloadUrl(key: string, ownerSub: string): Promise<string> {
  // キーのプレフィックスがリクエストユーザーの sub と一致するか検証
  if (!key.startsWith(`${ownerSub}/`)) {
    throw new Error('Unauthorized: cannot access other user\'s images');
  }

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  return getSignedUrl(s3Client, command, {
    expiresIn: DOWNLOAD_EXPIRY,
  });
}

async function getDownloadUrl(event: AppSyncEvent): Promise<string> {
  const { key } = event.arguments;
  const ownerSub = requireOwnerSub(event);

  if (!key) {
    throw new Error('Missing required argument: key');
  }

  return signDownloadUrl(key, ownerSub);
}

/**
 * 複数キーの Presigned URL をまとめて返す。
 *
 * 戻り値は keys と同じ並び・同じ件数にする。フロントはインデックスで
 * 突き合わせるため、途中を詰めたり並べ替えたりしてはいけない。
 * 1 件でも他人のキーが混ざっていれば全体を失敗させる（getDownloadUrl と同じ扱い）
 */
async function getDownloadUrls(event: AppSyncEvent): Promise<string[]> {
  const { keys } = event.arguments;
  const ownerSub = requireOwnerSub(event);

  if (!keys) {
    throw new Error('Missing required argument: keys');
  }

  if (keys.length === 0) {
    return [];
  }

  if (keys.length > MAX_DOWNLOAD_KEYS) {
    throw new Error(`Too many keys: ${keys.length}. Max: ${MAX_DOWNLOAD_KEYS}`);
  }

  return Promise.all(keys.map((key) => signDownloadUrl(key, ownerSub)));
}


/** コピー先で名前がぶつからないようにする（別フォルダの同名ファイル対策） */
function uniqueFileName(fileName: string, used: Set<string>): string {
  if (!used.has(fileName)) {
    used.add(fileName);
    return fileName;
  }

  const dotIndex = fileName.lastIndexOf('.');
  const stem = dotIndex === -1 ? fileName : fileName.slice(0, dotIndex);
  const ext = dotIndex === -1 ? '' : fileName.slice(dotIndex);

  for (let i = 2; i < 100; i += 1) {
    const candidate = `${stem}-${i}${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }

  throw new Error(`Cannot resolve a unique file name for: ${fileName}`);
}

/**
 * S3 にそのキーのオブジェクトがあるか。
 *
 * 「無い」と判定するのは 404 のときだけにする。すべての例外を false にすると、
 * スロットリングや権限エラーでもサムネイルを黙って飛ばしてしまい、
 * 原画だけが複製された不揃いな状態に気づけない
 */
async function objectExists(key: string): Promise<boolean> {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
    return true;
  } catch (error) {
    const name = (error as { name?: string }).name;
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;

    if (name === 'NotFound' || name === 'NoSuchKey' || status === 404) {
      return false;
    }

    throw error;
  }
}

/**
 * 別の記録の画像を、指定した記録のものとして複製する。
 *
 * キーの文字列だけを共有させると、片方の記録を削除したときに deleteImage が
 * S3 の実体を消して、もう片方の画像まで見えなくなる。実体ごと複製する。
 *
 * サムネイルは記録に保存されず原画から導出する兄弟キーなので、
 * 在るときだけ一緒に複製する（無ければ一覧は原画へフォールバックする）
 */
async function copyImages(event: AppSyncEvent): Promise<string[]> {
  const { sourceKeys, recordType, recordId } = event.arguments;
  const ownerSub = requireOwnerSub(event);

  if (!sourceKeys || !recordType || !recordId) {
    throw new Error('Missing required arguments: sourceKeys, recordType, recordId');
  }

  assertRecordLocation(recordType, recordId);

  // 同じキーが複数入っている記録があり、そのまま複製すると同じ画像が並ぶ
  const uniqueSources = [...new Set(sourceKeys)];

  if (uniqueSources.length === 0) {
    return [];
  }

  if (uniqueSources.length > MAX_IMAGES_PER_RECORD) {
    throw new Error(`Too many images: ${uniqueSources.length}. Max: ${MAX_IMAGES_PER_RECORD}`);
  }

  // 他人の画像を自分の記録へ引き込めないようにする
  for (const source of uniqueSources) {
    if (!source.startsWith(`${ownerSub}/`)) {
      throw new Error('Unauthorized: cannot copy other user\'s images');
    }
  }

  const usedNames = new Set<string>();
  const destinations: string[] = [];

  for (const source of uniqueSources) {
    // `/` で終わるキーを渡されるとファイル名が空になり、複製先が
    // フォルダを指すキーになる。記録には中身の無いキーが残る
    const sourceFileName = source.slice(source.lastIndexOf('/') + 1);
    assertFileName(sourceFileName);

    const fileName = uniqueFileName(sourceFileName, usedNames);
    const destination = `${ownerSub}/${recordType}/${recordId}/${fileName}`;

    await s3Client.send(
      new CopyObjectCommand({
        Bucket: BUCKET_NAME,
        Key: destination,
        CopySource: `${BUCKET_NAME}/${source}`,
      }),
    );
    destinations.push(destination);

    const sourceThumbnail = toThumbnailKey(source);
    if (await objectExists(sourceThumbnail)) {
      await s3Client.send(
        new CopyObjectCommand({
          Bucket: BUCKET_NAME,
          Key: toThumbnailKey(destination),
          CopySource: `${BUCKET_NAME}/${sourceThumbnail}`,
        }),
      );
    }
  }

  return destinations;
}

async function deleteImage(event: AppSyncEvent): Promise<{ success: boolean; imageDeleteFailed?: boolean }> {
  // 認可は引数を見る前に済ませる。削除パイプラインは画像を持たない記録でも
  // arguments を空にして呼ぶため、後ろに置くと identity の無い呼び出しに
  // success を返してしまう。他のハンドラと同じ順序に揃える
  const ownerSub = requireOwnerSub(event);

  // Pipeline リゾルバーから imageKey(単一) と imageKeys(複数) の両方を処理
  const imageKey = event.arguments?.imageKey || event.source?.imageKey;
  const imageKeys = event.arguments?.imageKeys || event.source?.imageKeys;

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

  let hasFailure = false;

  /**
   * ログに出すキーから所有者の sub を落とす（Issue #127）。
   *
   * キーは `{sub}/{種別}/{recordId}/{ファイル名}` の形式で、sub は利用者ごとに
   * 固定の識別子。そのまま出すとロググループに残り続ける。
   *
   * ただし丸ごと伏せると「どの画像の削除に失敗したか」が追えなくなるため、
   * 先頭の sub だけを落として残りは出す。削除に失敗した画像は
   * ImageDeleteFailCount のアラームから調べにいくので、recordId は要る。
   */
  const withoutOwner = (key: string, sub: string): string =>
    key.startsWith(`${sub}/`) ? key.slice(sub.length + 1) : '(redacted)';

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
        console.log(JSON.stringify({
          level: 'INFO',
          action: 'deleteImage',
          imageKey: withoutOwner(key, ownerSub),
          result: 'success',
        }));
      } catch (error) {
        hasFailure = true;
        console.error(JSON.stringify({
          level: 'ERROR',
          action: 'deleteImage',
          imageKey: withoutOwner(key, ownerSub),
          result: 'failed',
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    })
  );

  return { success: true, imageDeleteFailed: hasFailure };
}
