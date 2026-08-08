// Feature: ocr-tool-use-confidence, Property 2: Confidence スコアの不変条件

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { extractLabelInfo } from '../extractLabelInfo.js';

/** 任意の tool input（オブジェクト・非オブジェクトを含む雑多な値） */
const arbitraryToolInput = fc.oneof(
  fc.anything(),
  fc.record(
    {
      labelTexts: fc.array(fc.string()),
      sakeName: fc.oneof(fc.string(), fc.constant(null)),
      sakeNameConfidence: fc.oneof(fc.double(), fc.string(), fc.constant(null)),
      category: fc.oneof(fc.string(), fc.constant(null)),
      categoryConfidence: fc.oneof(fc.double(), fc.string(), fc.constant(null)),
      region: fc.oneof(fc.string(), fc.constant(null)),
      regionConfidence: fc.oneof(fc.double(), fc.string(), fc.constant(null)),
      alcoholPercentage: fc.oneof(fc.double(), fc.string(), fc.constant(null)),
      alcoholPercentageConfidence: fc.oneof(fc.double(), fc.string(), fc.constant(null)),
    },
    { requiredKeys: [] },
  ),
);

/**
 * **Validates: Requirements 3.2**
 *
 * Property 2: Confidence スコアの不変条件
 *
 * 任意の tool input を extractLabelInfo に入力した場合、
 * confidence および fieldConfidence の各値は必ず 0.0〜1.0 の範囲に収まること。
 * confidence は fieldConfidence.sakeName と一致すること。
 * 値が null の項目の確信度は必ず 0 であること。
 */
describe('Property 2: Confidence スコアの不変条件', () => {
  it('任意の tool input に対して確信度がすべて 0.0〜1.0 の範囲に収まる', () => {
    fc.assert(
      fc.property(arbitraryToolInput, (toolInput) => {
        const result = extractLabelInfo(toolInput);

        const values = [
          result.confidence,
          result.fieldConfidence.sakeName,
          result.fieldConfidence.category,
          result.fieldConfidence.region,
          result.fieldConfidence.alcoholPercentage,
        ];
        for (const v of values) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('confidence は常に fieldConfidence.sakeName と一致する', () => {
    fc.assert(
      fc.property(arbitraryToolInput, (toolInput) => {
        const result = extractLabelInfo(toolInput);

        expect(result.confidence).toBe(result.fieldConfidence.sakeName);
      }),
      { numRuns: 200 },
    );
  });

  it('null の項目の確信度は必ず 0 である', () => {
    fc.assert(
      fc.property(arbitraryToolInput, (toolInput) => {
        const result = extractLabelInfo(toolInput);

        if (result.sakeName === null) expect(result.fieldConfidence.sakeName).toBe(0);
        if (result.category === null) expect(result.fieldConfidence.category).toBe(0);
        if (result.region === null) expect(result.fieldConfidence.region).toBe(0);
        if (result.alcoholPercentage === null) {
          expect(result.fieldConfidence.alcoholPercentage).toBe(0);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('sakeName が null の場合は他の項目もすべて null で confidence 0.0 である', () => {
    fc.assert(
      fc.property(arbitraryToolInput, (toolInput) => {
        const result = extractLabelInfo(toolInput);

        if (result.sakeName === null) {
          expect(result.category).toBeNull();
          expect(result.region).toBeNull();
          expect(result.alcoholPercentage).toBeNull();
          expect(result.confidence).toBe(0.0);
          expect(result.rawTexts).toEqual([]);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('sakeName / region は常に最大長以内に収まる', () => {
    fc.assert(
      fc.property(arbitraryToolInput, (toolInput) => {
        const result = extractLabelInfo(toolInput);

        if (result.sakeName !== null) {
          expect(result.sakeName.length).toBeLessThanOrEqual(200);
        }
        if (result.region !== null) {
          expect(result.region.length).toBeLessThanOrEqual(100);
        }
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: ocr-tool-use-confidence, Property 3: rawTexts に転記テキストを含めない

/**
 * **Validates: Requirements 3.6**
 *
 * Property 3: rawTexts の安全性
 *
 * labelTexts（ラベル転記テキスト）はラベル由来の任意文字列を含みうるため、
 * どんな input でも rawTexts に labelTexts の内容が含まれないこと。
 */
describe('Property 3: rawTexts に転記テキストを含めない', () => {
  it('rawTexts に labelTexts の内容が含まれない', () => {
    fc.assert(
      fc.property(
        // 他フィールドと偶然一致しないよう、転記行にセンチネルを付与する
        fc.array(
          fc.string().map((s) => `SENTINEL_${s}_転記行`),
          { minLength: 1 },
        ),
        fc.string({ minLength: 1 }).filter((s) => !s.includes('SENTINEL_')),
        (labelTexts, sakeName) => {
          const result = extractLabelInfo({
            labelTexts,
            sakeName,
            sakeNameConfidence: 0.9,
            category: null,
            categoryConfidence: 0,
            region: null,
            regionConfidence: 0,
            alcoholPercentage: null,
            alcoholPercentageConfidence: 0,
          });

          for (const raw of result.rawTexts) {
            expect(raw).not.toContain('labelTexts');
            expect(raw).not.toContain('SENTINEL_');
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
