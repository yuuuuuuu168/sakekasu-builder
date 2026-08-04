/** サムネイルのファイル名に付けるプレフィックス */
export const THUMBNAIL_PREFIX = 'thumb_';

/**
 * 原画のキーから、対応するサムネイルのキーを導出する。
 *
 * S3 のキーは `<sub>/<recordType>/<recordId>/<fileName>` 形式で、
 * サムネイルはファイル名部分にプレフィックスを付けた兄弟キーとして保存する。
 * 保存済みレコードには原画キーだけを持たせ、サムネイルキーは
 * この関数で毎回導出する（スキーマ変更もマイグレーションも不要）。
 */
export function toThumbnailKey(key: string): string {
  const separatorIndex = key.lastIndexOf('/');
  if (separatorIndex === -1) {
    return `${THUMBNAIL_PREFIX}${key}`;
  }
  const dir = key.slice(0, separatorIndex + 1);
  const fileName = key.slice(separatorIndex + 1);
  return `${dir}${THUMBNAIL_PREFIX}${fileName}`;
}

/** ファイル名からサムネイル用のファイル名を作る（アップロード時に使用） */
export function toThumbnailFileName(fileName: string): string {
  return `${THUMBNAIL_PREFIX}${fileName}`;
}
