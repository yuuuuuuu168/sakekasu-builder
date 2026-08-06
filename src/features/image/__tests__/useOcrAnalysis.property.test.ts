/**
 * Feature: ai-ocr-sake-name, Property 6: エラー時のフォーム値保持
 *
 * 任意のフォーム状態（sakeName フィールドに任意の文字列が入力された状態）において、
 * OCR 解析がエラー（ネットワークエラー、タイムアウト、銘柄名未検出）で終了した場合、
 * sakeName フィールドの値は変更されないこと。
 *
 * Validates: Requirements 5.5
 */
import { renderHook, act } from '@testing-library/react';
import * as fc from 'fast-check';
import { useOcrAnalysis } from '../hooks/useOcrAnalysis';
import { vi } from 'vitest';

// vi.hoisted でモック関数を先に定義（vi.mock のホイスティング対応）
const { mockGraphql } = vi.hoisted(() => {
  const mockGraphql = vi.fn<(options: { query: string; variables: Record<string, unknown> }) => Promise<unknown>>();
  return { mockGraphql };
});

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({
    graphql: mockGraphql,
  }),
}));

/**
 * エラー種別の Arbitrary
 * - network: ネットワークエラー（一般的な Error throw）
 * - timeout: タイムアウトエラー（AbortError or timeout メッセージ）
 * - graphql-error: GraphQL レスポンスにエラーが含まれる
 * - graphql-timeout: GraphQL レスポンスにタイムアウトエラーが含まれる
 * - sakename-null: 銘柄名未検出（sakeName が null）
 */
const errorTypeArb = fc.constantFrom(
  'network',
  'timeout-abort',
  'timeout-message',
  'graphql-error',
  'graphql-timeout',
  'sakename-null',
) as fc.Arbitrary<string>;

/**
 * sakeName として使われうるランダムな文字列の Arbitrary
 * 日本語の銘柄名を想定し、空文字列も含む
 */
const sakeNameArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 50 }),
  fc.constantFrom('獺祭', '久保田 千寿', '八海山', '黒霧島', '響 21年', ''),
);

function setupMockForErrorType(errorType: string): void {
  switch (errorType) {
    case 'network':
      mockGraphql.mockRejectedValueOnce(new Error('Network error'));
      break;
    case 'timeout-abort': {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockGraphql.mockRejectedValueOnce(abortError);
      break;
    }
    case 'timeout-message':
      mockGraphql.mockRejectedValueOnce(new Error('Request timeout exceeded'));
      break;
    case 'graphql-error':
      mockGraphql.mockResolvedValueOnce({
        errors: [{ message: 'Internal server error' }],
      });
      break;
    case 'graphql-timeout':
      mockGraphql.mockResolvedValueOnce({
        errors: [{ message: 'Lambda timeout occurred' }],
      });
      break;
    case 'sakename-null':
      mockGraphql.mockResolvedValueOnce({
        data: {
          analyzeSakeLabel: {
            sakeName: null,
            confidence: 0.0,
            rawTexts: [],
          },
        },
      });
      break;
  }
}

describe('Property 6: エラー時のフォーム値保持', () => {
  beforeEach(() => {
    mockGraphql.mockReset();
  });

  it('任意の sakeName 値とエラー種別に対して、エラー後もフォーム値が保持される', async () => {
    await fc.assert(
      fc.asyncProperty(
        sakeNameArb,
        errorTypeArb,
        fc.uuid(),
        async (existingSakeName, errorType, imageKey) => {
          mockGraphql.mockReset();
          setupMockForErrorType(errorType);

          // フォームの sakeName 値をシミュレート
          let formSakeName = existingSakeName;

          const { result } = renderHook(() => useOcrAnalysis());

          // analyzeImage を実行
          let ocrResult: { sakeName: string | null } | null = null;
          await act(async () => {
            ocrResult = await result.current.analyzeImage([imageKey]);
          });

          // フォーム統合ロジック: result?.sakeName が truthy な場合のみ更新
          // （PurchaseForm / DrinkingForm の実装パターン）
          if (ocrResult?.sakeName) {
            formSakeName = ocrResult.sakeName;
          }

          // エラー時は formSakeName が変更されないことを検証
          if (errorType === 'sakename-null') {
            // sakeName が null の場合、ocrResult は返されるが sakeName は null
            // → result?.sakeName は null (falsy) なのでフォーム値は更新されない
            expect(formSakeName).toBe(existingSakeName);
            expect(ocrResult).not.toBeNull();
            expect(ocrResult!.sakeName).toBeNull();
          } else {
            // その他のエラーでは analyzeImage が null を返す
            // → result?.sakeName は undefined (falsy) なのでフォーム値は更新されない
            expect(formSakeName).toBe(existingSakeName);
            expect(ocrResult).toBeNull();
          }

          // フックのエラー状態が設定されていることも確認
          expect(result.current.ocrError).not.toBeNull();
          expect(result.current.isAnalyzing).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
