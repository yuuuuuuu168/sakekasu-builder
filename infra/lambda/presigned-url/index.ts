import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  MAX_IMAGES_PER_RECORD,
  MAX_UPLOAD_BYTES,
  TEMP_LOCATION,
  TEMP_OBJECT_TAGGING,
} from '../../lib/image-constants';

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
    temporary?: boolean;
    /** 原画ではなくその一覧用サムネイルを置く。キーは fileName から導出する */
    thumbnail?: boolean;
    /** これから置くファイルの大きさ（バイト）。署名に含め、この大きさでしか PUT できなくする */
    fileSize?: number | null;
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
  /**
   * この URL で付与されるタグ（一時領域以外では null）。
   *
   * 参考情報として返すだけで、クライアントはヘッダに載せてはいけない。
   * SDK はタグを署名済み URL のクエリ（`x-amz-tagging`）に入れるため、
   * ヘッダでも送ると二重指定になり S3 が 403 を返す（実機で確認済み）。
   * 値の確認や運用調査のために残している
   */
  taggingHeader: string | null;
}

/** そのキーがサムネイルを指しているか */
function isThumbnailKey(key: string): boolean {
  return key.slice(key.lastIndexOf('/') + 1).startsWith(THUMBNAIL_PREFIX);
}

/**
 * CopyObject の複製元に渡す値を組み立てる。
 *
 * `CopySource` は `x-amz-copy-source` ヘッダとして送られるため、URL エンコードが要る。
 * 素のキーを渡すと、日本語やスペースを含むファイル名で Node.js が
 * 「Invalid character in header content」を投げてコピーが落ちる。
 * 区切りの `/` は残す必要があるので、区画ごとにエンコードして繋ぎ直す
 */
function toCopySource(key: string): string {
  return `${BUCKET_NAME}/${key.split('/').map(encodeURIComponent).join('/')}`;
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

  assertRecordId(recordId);
}

/**
 * キーの階層に使う ID を検証する。
 *
 * 一時領域は記録種別を持たない（まだどの記録のものか決まっていない）が、
 * ID は同じくキーの階層に入るため検証は要る
 */
function assertRecordId(recordId: string): void {
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

/**
 * これから新しく置く原画のファイル名を検証する。
 *
 * `thumb_` は原画から導出するサムネイルのために予約している。この名前で
 * 原画を上げられると、同じ記録にある別の画像のサムネイルを原寸で上書きでき、
 * 一覧が静かに重くなる。サムネイル自身のキーはサーバー側で組み立てる。
 *
 * 複製（copyImages）には適用しない。既にこの名前で保存されている画像が
 * あり、そちらは引き継げないと記録から写真が消える
 */
function assertNewUploadFileName(fileName: string): void {
  assertFileName(fileName);

  if (fileName.startsWith(THUMBNAIL_PREFIX)) {
    throw new Error(`Invalid fileName: must not start with ${THUMBNAIL_PREFIX}`);
  }
}

/**
 * アップロードする大きさを検証する（Issue sakekasu-builder-archive#173）。
 *
 * 検証した値は `ContentLength` として署名に含める。SDK はこれを
 * `content-length` の署名対象ヘッダにするので、クライアントは申告した大きさで
 * しか PUT できない（`presignContentLength.test.ts` で SDK の挙動を固定している）。
 * 申告を偽って小さく言っても、実際の本体が違えば署名が合わず S3 が 403 を返す
 */
function assertUploadSize(fileSize: number): void {
  if (!Number.isInteger(fileSize) || fileSize <= 0 || fileSize > MAX_UPLOAD_BYTES) {
    throw new Error(`Invalid fileSize: must be an integer between 1 and ${MAX_UPLOAD_BYTES}`);
  }
}

async function generateUploadUrl(event: AppSyncEvent): Promise<UploadUrlResponse> {
  const { recordType, recordId, contentType, fileName, temporary, thumbnail, fileSize } =
    event.arguments;
  const ownerSub = requireOwnerSub(event);

  if (!recordType || !recordId || !contentType || !fileName) {
    throw new Error('Missing required arguments: recordType, recordId, contentType, fileName');
  }

  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    throw new Error(`Invalid contentType: ${contentType}. Allowed: ${ALLOWED_CONTENT_TYPES.join(', ')}`);
  }

  // 一時領域は記録がまだ無い段階の置き場なので、記録種別ではなく固定の区画に置く。
  // 種別は呼び出し側の都合で渡ってくるが、キーには使わない
  if (temporary) {
    assertRecordId(recordId);
  } else {
    assertRecordLocation(recordType, recordId);
  }
  assertNewUploadFileName(fileName);

  // 大きさを送らない呼び出しは、まだ通す。インフラとフロントはマージで同時に
  // デプロイされ、どちらが先に入るかは決まらない。ここで必須にすると、新しい
  // フロントが行き渡るまでの間、古いフロントのアップロードが全部落ちる。
  // 行き渡ったら必須にする（その間は署名に大きさが入らず、上限も効かない）
  if (fileSize !== undefined && fileSize !== null) {
    assertUploadSize(fileSize);
  } else {
    console.warn(JSON.stringify({
      level: 'WARN',
      action: 'generateUploadUrl',
      message: 'fileSize not provided; upload size is not signed',
    }));
  }

  const location = temporary ? TEMP_LOCATION : recordType;
  // サムネイルのキーはサーバー側で導出する。クライアントに `thumb_` 付きの
  // 名前を組み立てさせると、原画の名前として送られたときに区別できない
  const storedFileName = thumbnail ? `${THUMBNAIL_PREFIX}${fileName}` : fileName;
  const key = `${ownerSub}/${location}/${recordId}/${storedFileName}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
    // 申告された大きさを署名する。この URL ではこの大きさでしか置けなくなる
    ...(fileSize !== undefined && fileSize !== null ? { ContentLength: fileSize } : {}),
    // タグはライフサイクルの削除条件。SDK はこの値を署名済み URL の
    // クエリ（x-amz-tagging）に入れる。署名対象ヘッダには入らないので、
    // クライアントは同名のヘッダを送ってはいけない。送ると二重指定になり
    // S3 が 403 SignatureDoesNotMatch を返す（PR #147 で実機確認）
    ...(temporary ? { Tagging: TEMP_OBJECT_TAGGING } : {}),
  });

  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: UPLOAD_EXPIRY,
  });

  return { uploadUrl, key, taggingHeader: temporary ? TEMP_OBJECT_TAGGING : null };
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


/**
 * コピー先で名前がぶつからないように、使う名前を確保する。
 *
 * 別フォルダにある同名ファイルを 1 つの記録へまとめるため、2 枚目以降は
 * 拡張子の前に連番を入れる。
 *
 * サムネイルは原画名から導出する決まりで、連番を振って避けることができない。
 * そのため原画名を決める時点で、その導出先（`thumb_<名前>`）も一緒に押さえる。
 * `thumb_` を含むファイル名は利用者が普通に付けられるので、押さえておかないと
 * 「先に入れた画像のサムネイル」と「後から入れた画像の原画」が同じキーになり、
 * 片方が上書きされる
 */
function reserveFileName(fileName: string, used: Set<string>): string {
  // 既にサムネイルを指す名前なら、そこからさらに導出はしない
  const namesToTake = (name: string): string[] =>
    name.startsWith(THUMBNAIL_PREFIX) ? [name] : [name, `${THUMBNAIL_PREFIX}${name}`];

  const take = (candidate: string): boolean => {
    const names = namesToTake(candidate);
    if (names.some((name) => used.has(name))) {
      return false;
    }
    names.forEach((name) => used.add(name));
    return true;
  };

  if (take(fileName)) {
    return fileName;
  }

  const dotIndex = fileName.lastIndexOf('.');
  const stem = dotIndex === -1 ? fileName : fileName.slice(0, dotIndex);
  const ext = dotIndex === -1 ? '' : fileName.slice(dotIndex);

  for (let i = 2; i < 100; i += 1) {
    const candidate = `${stem}-${i}${ext}`;
    if (take(candidate)) {
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

  // 複製先に既にあるファイル名を先に押さえる。押さえないと、同じ名前の画像を
  // 後から追加したときに既存の実体を上書きしてしまう。記録は同じキーを指した
  // まま中身だけ入れ替わるので、画面上は気づけない（Issue #142 で編集からの
  // 追加ができるようになり、現実に起こりうる経路になった）
  const usedNames = new Set<string>();
  const destinationPrefix = `${ownerSub}/${recordType}/${recordId}/`;
  const existing = await s3Client.send(
    new ListObjectsV2Command({ Bucket: BUCKET_NAME, Prefix: destinationPrefix }),
  );
  for (const object of existing.Contents ?? []) {
    const name = object.Key?.slice(destinationPrefix.length);
    if (name) {
      usedNames.add(name);
    }
  }

  const destinations: string[] = [];

  for (const source of uniqueSources) {
    // `/` で終わるキーを渡されるとファイル名が空になり、複製先が
    // フォルダを指すキーになる。記録には中身の無いキーが残る
    const sourceFileName = source.slice(source.lastIndexOf('/') + 1);
    assertFileName(sourceFileName);

    const fileName = reserveFileName(sourceFileName, usedNames);
    const destination = `${ownerSub}/${recordType}/${recordId}/${fileName}`;

    await s3Client.send(
      new CopyObjectCommand({
        Bucket: BUCKET_NAME,
        Key: destination,
        CopySource: toCopySource(source),
        // CopyObject の既定はタグの引き継ぎ。一時領域から複製すると
        // 自動削除タグまで付いてきて、記録に紐づいた画像が 1 日で消える
        TaggingDirective: 'REPLACE',
        Tagging: '',
      }),
    );
    destinations.push(destination);

    // 元がすでにサムネイルなら、そこからさらに導出はしない。
    // thumb_thumb_... という在りもしないキーを探しにいくだけになる
    if (isThumbnailKey(source)) {
      continue;
    }

    const sourceThumbnail = toThumbnailKey(source);
    if (await objectExists(sourceThumbnail)) {
      await s3Client.send(
        new CopyObjectCommand({
          Bucket: BUCKET_NAME,
          Key: toThumbnailKey(destination),
          CopySource: toCopySource(sourceThumbnail),
          // 原画と同じ理由でタグを落とす（サムネイルだけ 1 日で消えると
          // 一覧が原画へフォールバックし、静かに重くなる）
          TaggingDirective: 'REPLACE',
          Tagging: '',
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
      // サムネイルは記録に保存されず原画から導出する兄弟キーなので、
      // 記録が持つキーだけを消すと消し残る（Issue #132）。
      // 未生成の記録もあるが、S3 は無いキーの削除もエラーにしないので
      // 存在を確かめずにまとめて消す。
      //
      // 記録が `thumb_` 始まりのキーを直接持っていることもある
      // （アップロードのファイル名に使うことを禁じていないため）。
      // そこへさらに導出をかけると thumb_thumb_... という在りもしない
      // キーを消しにいき、成功ログだけが増える
      const targets = isThumbnailKey(key) ? [key] : [key, toThumbnailKey(key)];

      await Promise.all(
        targets.map(async (target) => {
          try {
            const command = new DeleteObjectCommand({
              Bucket: BUCKET_NAME,
              Key: target,
            });
            await s3Client.send(command);
            console.log(JSON.stringify({
              level: 'INFO',
              action: 'deleteImage',
              imageKey: withoutOwner(target, ownerSub),
              result: 'success',
            }));
          } catch (error) {
            hasFailure = true;
            console.error(JSON.stringify({
              level: 'ERROR',
              action: 'deleteImage',
              imageKey: withoutOwner(target, ownerSub),
              result: 'failed',
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        })
      );
    })
  );

  return { success: true, imageDeleteFailed: hasFailure };
}
