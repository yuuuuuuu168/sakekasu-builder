// Issue #119: 宣言された ContentType だけでなく、先頭バイトで中身が画像かを見る

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

import {
  detectImageMediaType,
  resolveMediaType,
  assertImagesAreRealImages,
} from '../index.js';

/** 先頭バイトの後ろに適当な本体を足したバイト列を作る */
function bytesOf(header: number[], bodyLength = 32): Uint8Array {
  return new Uint8Array([...header, ...new Array(bodyLength).fill(0x00)]);
}

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
/** "RIFF" + サイズ4バイト + "WEBP" */
const WEBP = [
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
];
/** "%PDF-1.4" */
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34];

describe('detectImageMediaType', () => {
  it('JPEG を判定する', () => {
    expect(detectImageMediaType(bytesOf(JPEG))).toBe('image/jpeg');
  });

  it('PNG を判定する', () => {
    expect(detectImageMediaType(bytesOf(PNG))).toBe('image/png');
  });

  it('4バイト目のマーカーが JFIF・Exif 以外でも JPEG と判定する', () => {
    // 量子化テーブル（DB）から始まる JPEG も Adobe の APP14（EE）も正当な画像。
    // ここを JFIF（E0）と Exif（E1）に絞ると本物を弾く
    expect(detectImageMediaType(bytesOf([0xff, 0xd8, 0xff, 0xdb]))).toBe('image/jpeg');
    expect(detectImageMediaType(bytesOf([0xff, 0xd8, 0xff, 0xee]))).toBe('image/jpeg');
  });

  it('GIF89a を判定する', () => {
    expect(detectImageMediaType(bytesOf(GIF))).toBe('image/gif');
  });

  it('GIF87a を判定する', () => {
    const gif87a = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];

    expect(detectImageMediaType(bytesOf(gif87a))).toBe('image/gif');
  });

  it('GIF8 で始まっても版が 87a / 89a でなければ判定しない', () => {
    const unknownVersion = [0x47, 0x49, 0x46, 0x38, 0x00, 0x00];

    expect(detectImageMediaType(bytesOf(unknownVersion))).toBeNull();
  });

  it('WebP を判定する', () => {
    expect(detectImageMediaType(bytesOf(WEBP))).toBe('image/webp');
  });

  it('PDF は画像として判定しない', () => {
    expect(detectImageMediaType(bytesOf(PDF))).toBeNull();
  });

  it('RIFF で始まっても WEBP でなければ判定しない', () => {
    // "RIFF" + サイズ + "WAVE"。先頭4バイトだけを見ると取り違える
    const wave = [
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ];

    expect(detectImageMediaType(bytesOf(wave))).toBeNull();
  });

  it('マジックバイトの途中までしか無いファイルは判定しない', () => {
    // 範囲外の添字は undefined になり、どの形式とも一致しない
    expect(detectImageMediaType(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  it('空のファイルは判定しない', () => {
    expect(detectImageMediaType(new Uint8Array([]))).toBeNull();
  });
});

describe('resolveMediaType', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const)(
    '%s はそのまま通す',
    (contentType) => {
      expect(resolveMediaType(contentType)).toBe(contentType);
    },
  );

  it('認識できない ContentType は jpeg に丸めず落とす', () => {
    expect(() => resolveMediaType('application/pdf')).toThrow('Unsupported image type');
  });

  it('ContentType が無いオブジェクトも落とす', () => {
    expect(() => resolveMediaType(undefined)).toThrow('Unsupported image type');
  });

  it('大文字表記は通さない（S3 が保存した値をそのまま照合する）', () => {
    expect(() => resolveMediaType('IMAGE/JPEG')).toThrow('Unsupported image type');
  });

  it('ログを改行で分断されない形にして出す', () => {
    const spy = vi.spyOn(console, 'error');

    expect(() => resolveMediaType('image/jpeg\n[OCR] fake log line')).toThrow();

    const logged = spy.mock.calls.flat().join(' ');
    expect(logged.split('\n')).toHaveLength(1);
  });
});

describe('assertImagesAreRealImages', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('宣言と中身が一致していれば通す', () => {
    const images = [
      { bytes: bytesOf(JPEG), mediaType: 'image/jpeg' as const },
      { bytes: bytesOf(PNG), mediaType: 'image/png' as const },
    ];

    expect(() => assertImagesAreRealImages(images)).not.toThrow();
  });

  it('jpg に見せかけた PDF を落とす', () => {
    const images = [{ bytes: bytesOf(PDF), mediaType: 'image/jpeg' as const }];

    expect(() => assertImagesAreRealImages(images)).toThrow('Invalid image content');
  });

  it('中身は画像でも宣言と食い違えば落とす', () => {
    const images = [{ bytes: bytesOf(PNG), mediaType: 'image/jpeg' as const }];

    expect(() => assertImagesAreRealImages(images)).toThrow('Invalid image content');
  });

  it('複数枚のうち1枚でも非画像なら落とす', () => {
    const images = [
      { bytes: bytesOf(JPEG), mediaType: 'image/jpeg' as const },
      { bytes: bytesOf(PDF), mediaType: 'image/png' as const },
    ];

    expect(() => assertImagesAreRealImages(images)).toThrow('Invalid image content');
  });

  it('画像が無いときは何もしない', () => {
    expect(() => assertImagesAreRealImages([])).not.toThrow();
  });

  it('落とすときに利用者の識別子をログへ出さない', () => {
    const spy = vi.spyOn(console, 'error');
    const images = [
      { bytes: bytesOf(JPEG), mediaType: 'image/jpeg' as const },
      { bytes: bytesOf(PDF), mediaType: 'image/jpeg' as const },
    ];

    expect(() => assertImagesAreRealImages(images)).toThrow();

    // S3 のキーには sub が入る。位置と判定結果だけを出す
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).toContain('index=1');
    expect(logged).toContain('detected=unknown');
    expect(logged).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});
