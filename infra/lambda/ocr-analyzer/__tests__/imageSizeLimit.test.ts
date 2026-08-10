// Issue #115: Bedrock の画像上限は base64 エンコード後の長さで判定される

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// AWS SDK モジュールをモックして import エラーを回避
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(),
  GetObjectCommand: vi.fn(),
}));
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn(),
  InvokeModelCommand: vi.fn(),
}));

import { assertImagesFitBedrockLimit } from '../index.js';

/** Bedrock 側の上限（base64 エンコード後） */
const LIMIT = 5 * 1024 * 1024;

/** 指定した base64 長を持つ画像を作る */
function imageOf(base64Length: number): { base64: string } {
  return { base64: 'a'.repeat(base64Length) };
}

describe('assertImagesFitBedrockLimit', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('上限ちょうどは通す', () => {
    expect(() => assertImagesFitBedrockLimit([imageOf(LIMIT)])).not.toThrow();
  });

  it('上限を1バイト超えたら落とす', () => {
    expect(() => assertImagesFitBedrockLimit([imageOf(LIMIT + 1)])).toThrow(
      'Image too large for OCR',
    );
  });

  it('複数枚のうち1枚でも超えていれば落とす', () => {
    const images = [imageOf(1000), imageOf(LIMIT + 1), imageOf(2000)];

    expect(() => assertImagesFitBedrockLimit(images)).toThrow('Image too large for OCR');
  });

  it('画像が無いときは何もしない', () => {
    expect(() => assertImagesFitBedrockLimit([])).not.toThrow();
  });

  it('元ファイルが 3.75MB 以下なら base64 にしても通る（フロントの上限と噛み合う）', () => {
    // フロント側（imageCompressor.ts）は上限を base64 制限の 3/4 に置いている。
    // その上限いっぱいのファイルを base64 にした長さで検証する
    const maxFileSize = Math.floor((LIMIT * 3) / 4);
    const base64Length = Math.ceil(maxFileSize / 3) * 4;

    expect(base64Length).toBeLessThanOrEqual(LIMIT);
    expect(() => assertImagesFitBedrockLimit([imageOf(base64Length)])).not.toThrow();
  });

  it('落とすときに利用者の識別子をログへ出さない', () => {
    const spy = vi.spyOn(console, 'error');

    expect(() => assertImagesFitBedrockLimit([imageOf(LIMIT + 1)])).toThrow();

    // S3 のキーには sub が入る。位置と長さだけを出す
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).toContain('index=0');
    expect(logged).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});
