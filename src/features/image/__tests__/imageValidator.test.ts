import { describe, it, expect } from 'vitest';
import { validateImageFile, validateRecordImageFile } from '../utils/imageValidator';

describe('validateImageFile', () => {
  it('JPEG ファイルを受け入れる', () => {
    const file = new File(['dummy'], 'photo.jpg', { type: 'image/jpeg' });
    const result = validateImageFile(file);
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it('PNG ファイルを受け入れる', () => {
    const file = new File(['dummy'], 'photo.png', { type: 'image/png' });
    const result = validateImageFile(file);
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it('GIF ファイルを拒否しエラーメッセージを返す', () => {
    const file = new File(['dummy'], 'animation.gif', { type: 'image/gif' });
    const result = validateImageFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('JPEG または PNG 形式の画像を選択してください');
  });

  it('WebP ファイルを拒否する', () => {
    const file = new File(['dummy'], 'photo.webp', { type: 'image/webp' });
    const result = validateImageFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('JPEG または PNG 形式の画像を選択してください');
  });

  it('PDF ファイルを拒否する', () => {
    const file = new File(['dummy'], 'doc.pdf', { type: 'application/pdf' });
    const result = validateImageFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('JPEG または PNG 形式の画像を選択してください');
  });

  it('空の MIME タイプを拒否する', () => {
    const file = new File(['dummy'], 'unknown', { type: '' });
    const result = validateImageFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('JPEG または PNG 形式の画像を選択してください');
  });

  // 予約プレフィックスの判定は記録用の入口だけに置く。共通の
  // validateImageFile に入れると、S3 のキーにならないソムリエの相談画像まで
  // 巻き添えで拒否される（PR #144 のレビュー指摘）
  it('thumb_ で始まる名前でも形式が合っていれば通す（相談画像用）', () => {
    const file = new File(['dummy'], 'thumb_photo.jpg', { type: 'image/jpeg' });
    expect(validateImageFile(file).valid).toBe(true);
  });
});

// サムネイルは原画と同じ場所に thumb_ を付けたキーで置く。同じ記録に
// photo.jpg と thumb_photo.jpg を入れると、後者の原画が前者のサムネイルを
// 上書きし、一覧が静かに原寸を読み続ける（PR #144 のレビュー指摘）
describe('validateRecordImageFile', () => {
  it('thumb_ で始まるファイル名を拒否する', () => {
    const file = new File(['dummy'], 'thumb_photo.jpg', { type: 'image/jpeg' });
    const result = validateRecordImageFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('thumb_');
  });

  it('名前の途中に thumb_ があるだけなら通す', () => {
    const file = new File(['dummy'], 'my_thumb_photo.jpg', { type: 'image/jpeg' });
    expect(validateRecordImageFile(file).valid).toBe(true);
  });

  it('thumb（アンダースコア無し）で始まる名前は通す', () => {
    const file = new File(['dummy'], 'thumbnail.jpg', { type: 'image/jpeg' });
    expect(validateRecordImageFile(file).valid).toBe(true);
  });

  it('形式の検証も引き継ぐ', () => {
    const file = new File(['dummy'], 'photo.webp', { type: 'image/webp' });
    const result = validateRecordImageFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('JPEG または PNG 形式の画像を選択してください');
  });
});
