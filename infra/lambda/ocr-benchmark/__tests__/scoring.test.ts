import { describe, expect, it } from 'vitest';
import { extractLabelInfo } from '../../ocr-analyzer/extractLabelInfo.js';
import {
  estimateCostUsd,
  normalizeText,
  scoreField,
  scoreRecord,
  similarity,
  summarize,
  type CallResult,
} from '../scoring.js';
import { errorLabel, resolvePlan, selectRecords, DEFAULT_MODELS } from '../index.js';

describe('normalizeText', () => {
  it('全角・半角、空白、会社の種類の表記を均す', () => {
    expect(normalizeText('ＡＢＣ 酒造 株式会社')).toBe('abc酒造');
    expect(normalizeText('獺祭・純米大吟醸')).toBe('獺祭純米大吟醸');
  });
});

describe('scoreField', () => {
  it('正解が空の項目は採点しない', () => {
    expect(scoreField('acidity', null, 1.4)).toBeUndefined();
    expect(scoreField('brewery', '  ', '旭酒造')).toBeUndefined();
  });

  it('数値は 0.05 までの差を一致とみなす', () => {
    expect(scoreField('alcoholPercentage', 15.5, 15.5)).toBe(true);
    expect(scoreField('alcoholPercentage', 15.5, 15.52)).toBe(true);
    expect(scoreField('alcoholPercentage', 15.5, 16)).toBe(false);
    expect(scoreField('volumeMl', 720, null)).toBe(false);
  });

  it('産地や蔵元は片方がもう片方を含めば一致', () => {
    expect(scoreField('region', '山口県', '山口')).toBe(true);
    expect(scoreField('brewery', '旭酒造株式会社', '旭酒造')).toBe(true);
    expect(scoreField('region', '山口県', '新潟県')).toBe(false);
  });

  it('銘柄名とカテゴリは均したうえでの完全一致', () => {
    expect(scoreField('sakeName', '獺祭 純米大吟醸', '獺祭純米大吟醸')).toBe(true);
    expect(scoreField('sakeName', '獺祭 純米大吟醸 磨き二割三分', '獺祭')).toBe(false);
    expect(scoreField('category', 'NIHONSHU', 'NIHONSHU')).toBe(true);
    expect(scoreField('category', 'NIHONSHU', 'SHOCHU')).toBe(false);
  });
});

describe('similarity', () => {
  it('同じなら 1、まったく違えば 0、部分一致は間の値', () => {
    expect(similarity('獺祭', '獺祭')).toBe(1);
    expect(similarity('獺祭', '久保田')).toBe(0);
    const partial = similarity('獺祭 純米大吟醸 磨き二割三分', '獺祭 純米大吟醸');
    expect(partial).toBeGreaterThan(0.5);
    expect(partial).toBeLessThan(1);
  });
});

describe('scoreRecord', () => {
  it('tool_use が欠けた結果は、正解のある項目がすべて外れになる', () => {
    const score = scoreRecord({ sakeName: '獺祭', category: 'NIHONSHU', acidity: null }, extractLabelInfo(null));
    expect(score.fields).toEqual({ sakeName: false, category: false });
    expect(score.sakeNameSimilarity).toBe(0);
  });
});

describe('estimateCostUsd', () => {
  it('単価表から費用を出し、表に無いモデルは null', () => {
    const usage = { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 };
    expect(estimateCostUsd('claude-opus-5-5', usage)).toBe(24);
    expect(estimateCostUsd('claude-fable-9-9', usage)).toBeNull();
  });
});

describe('summarize', () => {
  const call = (overrides: Partial<CallResult>): CallResult => ({
    model: 'claude-haiku-5-5',
    effort: 'low',
    record: 0,
    ms: 1000,
    usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 },
    costUsd: 0.001,
    stopReason: 'tool_use',
    score: { fields: { sakeName: true, category: true }, sakeNameSimilarity: 1 },
    ...overrides,
  });

  it('モデルと effort の組ごとに正解率・時間・費用をまとめ、失敗は正解率から外す', () => {
    const [summary] = summarize([
      call({ ms: 1000 }),
      call({ ms: 3000, score: { fields: { sakeName: false, category: true }, sakeNameSimilarity: 0.5 } }),
      call({ ms: 99_000, error: 'RateLimitError:429', costUsd: 0, score: undefined }),
    ]);
    expect(summary.calls).toBe(3);
    expect(summary.errors).toBe(1);
    expect(summary.ms.max).toBe(3000);
    expect(summary.fields.sakeName).toEqual({ correct: 1, total: 2, rate: 0.5 });
    expect(summary.overallRate).toBe(0.75);
    expect(summary.costUsd).toBe(0.002);
  });

  it('単価の分からないモデルが混ざれば費用は null', () => {
    const [summary] = summarize([call({ costUsd: null })]);
    expect(summary.costUsd).toBeNull();
    expect(summary.costPerCallUsd).toBeNull();
  });
});

describe('resolvePlan', () => {
  it('省けば既定のモデル・low・30 件', () => {
    expect(resolvePlan({})).toEqual({
      models: DEFAULT_MODELS,
      efforts: ['low'],
      limit: 30,
      offset: 0,
      concurrency: 8,
    });
  });

  it('形の違うモデル名・effort・範囲外の件数は落とす', () => {
    expect(() => resolvePlan({ models: ['gpt-5'] })).toThrow();
    expect(() => resolvePlan({ efforts: ['huge'] })).toThrow();
    expect(() => resolvePlan({ limit: 0 })).toThrow();
    expect(() => resolvePlan({ limit: 1.5 })).toThrow();
  });
});

describe('selectRecords', () => {
  it('画像と銘柄名のある記録を新しい順に選び、在庫から飲んだ記録は元の購入と二重に数えない', () => {
    const purchases = [
      { id: 'p1', sakeName: 'A', imageKeys: ['k1', 'k2', 'k3', 'k4'], createdAt: '2026-01-01' },
      { id: 'p2', sakeName: 'B', imageKey: 'k5', createdAt: '2026-03-01' },
      { id: 'p3', sakeName: 'C', createdAt: '2026-04-01' },
    ];
    const drinkings = [
      { id: 'd1', sakeName: 'A', imageKeys: ['k6'], purchaseRecordId: 'p1', createdAt: '2026-05-01' },
      { id: 'd2', sakeName: 'D', imageKeys: ['k7'], createdAt: '2026-02-01' },
    ];
    const selected = selectRecords(purchases, drinkings, 0, 10);
    expect(selected.map((r) => r.truth.id)).toEqual(['p2', 'd2', 'p1']);
    expect(selected[2].imageKeys).toEqual(['k1', 'k2', 'k3']);
    expect(selectRecords(purchases, drinkings, 1, 1).map((r) => r.truth.id)).toEqual(['d2']);
  });
});

describe('errorLabel', () => {
  it('状態コードがあれば添え、本文は出さない', () => {
    class RateLimitError extends Error {
      status = 429;
    }
    expect(errorLabel(new RateLimitError('secret body'))).toBe('RateLimitError:429');
    expect(errorLabel(new TypeError('x'))).toBe('TypeError');
    expect(errorLabel('x')).toBe('unknown');
  });
});
