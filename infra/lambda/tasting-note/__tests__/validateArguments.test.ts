/**
 * ノート生成 Lambda の入力検証のテスト。
 *
 * 呼び出し1回がモデルの課金につながるので、モデルを呼ぶ前に
 * 弾けているか（カテゴリ・銘柄名）をここで固定する。
 *
 * 控えのモデル ID（BEDROCK_MODEL_ID）に既定値を持たせないことの検査は、
 * 呼び出し口と一緒に lambda/shared/__tests__/llm.test.ts へ移した。
 */
import { describe, it, expect, vi } from 'vitest';

// モデルの呼び出し口（Claude API / Bedrock）は使わないので、SDK ごと読み込まない
vi.mock('../../shared/llm', () => ({
  createLlmClient: () => ({ callTool: vi.fn() }),
}));

import { assertNotableCategory, normalizeSakeName } from '../index.js';

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
