/**
 * 画像ファイルバリデーション
 * アップロード可能なファイル形式を JPEG / PNG に限定する
 */

import { THUMBNAIL_PREFIX } from '../lib/thumbnailKey';

export interface ValidationResult {
  valid: boolean;
  error: string | null;
}

/** 許可するMIMEタイプ */
const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
]);

/**
 * ファイル形式バリデーション
 *
 * 許可形式: JPEG（image/jpeg）、PNG（image/png）
 *
 * @param file - バリデーション対象のファイル
 * @returns バリデーション結果（valid: true なら受け入れ可能）
 *
 * Validates: Requirements 2.1, 2.2, 2.3
 */
export function validateImageFile(file: File): ValidationResult {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return {
      valid: false,
      error: 'JPEG または PNG 形式の画像を選択してください',
    };
  }

  // サムネイルは原画と同じ場所に `thumb_` を付けたキーで置く決まりなので、
  // この名前で始まる画像を一緒に上げると、片方のサムネイルを原画が上書きする。
  // 一覧が原寸を読み続ける状態になり、しかも見た目には分からない
  if (file.name.startsWith(THUMBNAIL_PREFIX)) {
    return {
      valid: false,
      error: `「${THUMBNAIL_PREFIX}」で始まるファイル名は使えません。名前を変えて選び直してください`,
    };
  }

  return {
    valid: true,
    error: null,
  };
}
