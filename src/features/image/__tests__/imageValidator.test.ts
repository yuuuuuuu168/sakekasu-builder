import { describe, it, expect } from 'vitest';
import { validateImageFile } from '../utils/imageValidator';

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
});
