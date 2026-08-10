// Issue #82: IAM が1モデルの ARN しか許可していないため、モデルIDの既定値を持たない。
//
// 「既定値が無いこと」をソースの文字列検査で見るのはやめた。`process.env.X ?? '…'`
// を弾く正規表現を書いても、ブラケット記法・分割代入の既定値・一度別の変数に
// 受けてから `??` する書き方など、すり抜ける形がいくらでもある。
// 環境変数を外して実際に呼び、例外になることで見る。

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

import { resolveModelId } from '../index.js';

describe('resolveModelId', () => {
  const original = process.env.BEDROCK_MODEL_ID;

  beforeEach(() => {
    delete process.env.BEDROCK_MODEL_ID;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.BEDROCK_MODEL_ID;
    } else {
      process.env.BEDROCK_MODEL_ID = original;
    }
  });

  // 既定値へ落ちると、許可されていないモデルを呼びに行って
  // AccessDeniedException になる。設定漏れは設定漏れとして出す
  it('環境変数が無ければ例外にする（既定値へ落ちない）', () => {
    expect(() => resolveModelId()).toThrow('BEDROCK_MODEL_ID is not set');
  });

  it('環境変数が空文字でも例外にする', () => {
    process.env.BEDROCK_MODEL_ID = '';

    expect(() => resolveModelId()).toThrow('BEDROCK_MODEL_ID is not set');
  });

  it('環境変数の値をそのまま返す', () => {
    process.env.BEDROCK_MODEL_ID = 'jp.anthropic.claude-haiku-4-5-20251001-v1:0';

    expect(resolveModelId()).toBe('jp.anthropic.claude-haiku-4-5-20251001-v1:0');
  });
});
