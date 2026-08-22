/**
 * ノート生成 Lambda の入力検証のテスト。
 *
 * 呼び出し1回が Bedrock の課金につながるので、Bedrock を呼ぶ前に
 * 弾けているか（カテゴリ・銘柄名）をここで固定する。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

// AWS SDK モジュールをモックして import エラーを回避（ocr-analyzer のテストと同じ）
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn(),
  InvokeModelCommand: vi.fn(),
}));

import { assertNotableCategory, normalizeSakeName, resolveModelId } from '../index.js';

describe('assertNotableCategory', () => {
  it('ウイスキーと日本酒は通す', () => {
    expect(assertNotableCategory('WHISKY')).toBe('WHISKY');
    expect(assertNotableCategory('NIHONSHU')).toBe('NIHONSHU');
  });

  // フロントは対象外カテゴリで呼ばないが、API を直接叩かれた場合の歯止め
  it('それ以外のカテゴリは落とす', () => {
    for (const category of ['BEER', 'WINE', 'SHOCHU', 'OTHER', undefined, null, 'WHISKEY']) {
      expect(() => assertNotableCategory(category)).toThrow(
        'Tasting notes are only available for WHISKY and NIHONSHU',
      );
    }
  });
});

describe('normalizeSakeName', () => {
  it('前後の空白を落とす', () => {
    expect(normalizeSakeName('  山崎 12年  ')).toBe('山崎 12年');
  });

  it('空の銘柄名は落とす', () => {
    for (const value of ['', '   ', undefined, null, 42]) {
      expect(() => normalizeSakeName(value)).toThrow('sakeName is required');
    }
  });

  it('長すぎる銘柄名は切り詰める', () => {
    expect(normalizeSakeName('獺祭'.repeat(200))).toHaveLength(200);
  });
});

describe('resolveModelId', () => {
  const original = process.env.BEDROCK_MODEL_ID;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.BEDROCK_MODEL_ID;
    } else {
      process.env.BEDROCK_MODEL_ID = original;
    }
  });

  it('環境変数の値を返す', () => {
    process.env.BEDROCK_MODEL_ID = 'jp.anthropic.claude-haiku-4-5-20251001-v1:0';
    expect(resolveModelId()).toBe('jp.anthropic.claude-haiku-4-5-20251001-v1:0');
  });

  // 既定値を持たせると、設定漏れが AccessDeniedException として出てくる
  it('環境変数が無ければ落とす', () => {
    delete process.env.BEDROCK_MODEL_ID;
    expect(() => resolveModelId()).toThrow('BEDROCK_MODEL_ID is not set');
  });
});
