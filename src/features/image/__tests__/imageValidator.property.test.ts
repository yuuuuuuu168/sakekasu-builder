import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateImageFile } from '../utils/imageValidator';

/**
 * Property 1: JPEG/PNGファイルは常にバリデーション成功する
 * Validates: Requirements 2.1
 *
 * 許可されたMIMEタイプ（image/jpeg, image/png）のファイルは
 * 常に valid: true, error: null を返すことを検証する。
 */
describe('Property 1: JPEG/PNGファイルは常にバリデーション成功する', () => {
  /** 許可されたMIMEタイプを生成する Arbitrary */
  const validMimeTypeArb = fc.constantFrom('image/jpeg', 'image/png');

  /** 任意のファイル名を生成する Arbitrary */
  const fileNameArb = fc.string({ minLength: 1 }).map((s) => s.replace(/\0/g, '_'));

  /** 任意のファイル内容を生成する Arbitrary */
  const fileContentArb = fc.string();

  it('許可されたMIMEタイプのファイルは常にバリデーション成功する', () => {
    fc.assert(
      fc.property(
        validMimeTypeArb,
        fileNameArb,
        fileContentArb,
        (mimeType, fileName, content) => {
          const file = new File([content], fileName, { type: mimeType });
          const result = validateImageFile(file);

          expect(result.valid).toBe(true);
          expect(result.error).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('許可されていないMIMEタイプのファイルは常にバリデーション失敗する', () => {
    /** image/jpeg, image/png 以外の任意のMIMEタイプを生成する Arbitrary */
    const invalidMimeTypeArb = fc
      .string()
      .filter((s) => s !== 'image/jpeg' && s !== 'image/png');

    fc.assert(
      fc.property(
        invalidMimeTypeArb,
        fileNameArb,
        fileContentArb,
        (mimeType, fileName, content) => {
          const file = new File([content], fileName, { type: mimeType });
          const result = validateImageFile(file);

          expect(result.valid).toBe(false);
          expect(result.error).toBe(
            'JPEG または PNG 形式の画像を選択してください',
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
