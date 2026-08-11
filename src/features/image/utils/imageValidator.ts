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

  return {
    valid: true,
    error: null,
  };
}

/**
 * 記録に添付する画像のバリデーション。
 *
 * 形式の判定に加えて、サムネイルのために予約しているファイル名を弾く。
 * サムネイルは原画と同じ場所に `thumb_` を付けたキーで置くので、この名前で
 * 始まる画像を一緒に上げると、片方のサムネイルを原画が上書きする。
 * 一覧が原寸を読み続ける状態になり、しかも見た目には分からない。
 *
 * ソムリエの相談に添える画像は S3 のキーにならないため、この検証は通さない。
 * 共通の validateImageFile に入れると、`thumb_旅行.jpg` のような普通の
 * ファイル名が相談にも使えなくなる（PR #144 のレビュー指摘）
 */
export function validateRecordImageFile(file: File): ValidationResult {
  const base = validateImageFile(file);
  if (!base.valid) {
    return base;
  }

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
