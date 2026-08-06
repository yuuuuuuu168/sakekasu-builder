// Feature: ai-ocr-sake-name, Property 2: Confidence スコアの不変条件

import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { extractLabelInfo } from '../extractLabelInfo.js';

/**
 * **Validates: Requirements 3.2**
 *
 * Property 2: Confidence スコアの不変条件
 *
 * 任意の Bedrock レスポンステキストを extractLabelInfo に入力した場合、
 * 返される confidence 値は 0.0 または 0.9 のいずれかであること。
 * sakeName が null でない有効な文字列の場合は 0.9、sakeName が null の場合は 0.0 であること。
 */
describe('Property 2: Confidence スコアの不変条件', () => {
  it('任意の Bedrock レスポンステキストに対して confidence が 0.0 または 0.9 のいずれかである', () => {
    fc.assert(
      fc.property(fc.string(), (bedrockResponseText) => {
        const result = extractLabelInfo(bedrockResponseText);

        // confidence は 0.0 または 0.9 のいずれかであること
        expect(result.confidence === 0.0 || result.confidence === 0.9).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('sakeName が null でない場合は confidence が 0.9 である', () => {
    fc.assert(
      fc.property(fc.string(), (bedrockResponseText) => {
        const result = extractLabelInfo(bedrockResponseText);

        if (result.sakeName !== null) {
          expect(result.confidence).toBe(0.9);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('sakeName が null の場合は confidence が 0.0 である', () => {
    fc.assert(
      fc.property(fc.string(), (bedrockResponseText) => {
        const result = extractLabelInfo(bedrockResponseText);

        if (result.sakeName === null) {
          expect(result.confidence).toBe(0.0);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: ai-ocr-sake-name, Property 3: rawTexts の完全性

/**
 * **Validates: Requirements 3.6**
 *
 * Property 3: rawTexts の完全性
 *
 * <answer> タグを含まない任意の Bedrock レスポンステキストを extractLabelInfo に
 * 入力した場合、返される rawTexts フィールドはそのレスポンステキスト全体を含むこと。
 * 具体的には rawTexts[0] === bedrockResponseText であること。
 * （タグがある場合は転記テキストをクライアントに返さないため、rawTexts には
 * タグの中身のみが入る。タグが複数の場合は不審入力として rawTexts は空になる）
 */
describe('Property 3: rawTexts の完全性', () => {
  it('タグなしレスポンスでは rawTexts[0] が入力テキスト全体と一致する', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !s.includes('<answer>')),
        (bedrockResponseText) => {
          const result = extractLabelInfo(bedrockResponseText);

          // rawTexts は少なくとも1要素を持つこと
          expect(result.rawTexts.length).toBeGreaterThanOrEqual(1);

          // rawTexts[0] が入力テキスト全体と一致すること
          expect(result.rawTexts[0]).toBe(bedrockResponseText);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('タグありレスポンスでは rawTexts に転記テキストが含まれない', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !s.includes('<answer>') && !s.includes('</answer>')),
        (transcription) => {
          const result = extractLabelInfo(
            `${transcription}\n<answer>{"sakeName": "テスト"}</answer>`,
          );

          expect(result.rawTexts).toEqual(['{"sakeName": "テスト"}']);
        },
      ),
      { numRuns: 100 },
    );
  });
});
