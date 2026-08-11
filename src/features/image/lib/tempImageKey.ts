/**
 * OCR の事前アップロード先（一時領域）に関する取り決め。
 *
 * サーバー側の定義は `infra/lib/image-constants.ts`。値を変えるときは両方を揃える
 * （サムネイルの `thumb_` プレフィックスと同じ扱い）。
 */

/** 一時領域を表すキーの区画。キーは `{sub}/tmp/{uploadId}/{fileName}` になる */
export const TEMP_LOCATION = 'tmp';

/**
 * そのキーが一時領域を指しているか。
 *
 * 一時領域のキーをそのまま記録に保存すると、ライフサイクルで画像が消えて
 * 記録だけが残る。保存前に正式な場所へ複製する必要がある
 */
export function isTemporaryKey(key: string): boolean {
  return key.split('/')[1] === TEMP_LOCATION;
}
