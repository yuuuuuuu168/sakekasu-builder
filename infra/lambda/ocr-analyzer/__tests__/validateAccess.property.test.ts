// Feature: ai-ocr-sake-name, Property 1: アクセス制御 — imageKey プレフィックス不一致時の拒否

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';

// AWS SDK モジュールをモックして import エラーを回避
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(),
  GetObjectCommand: vi.fn(),
}));
vi.mock('@aws-sdk/client-rekognition', () => ({
  RekognitionClient: vi.fn(),
  DetectTextCommand: vi.fn(),
}));

import { validateImageKeyAccess } from '../index.js';

/**
 * **Validates: Requirements 2.5, 7.2, 7.3, 7.4**
 *
 * Property 1: アクセス制御 — imageKey プレフィックス不一致時の拒否
 *
 * 任意のユーザー sub と imageKey のペアに対して、imageKey のプレフィックスが
 * sub と一致しない場合、validateImageKeyAccess は
 * 「Unauthorized: cannot access other user's images」エラーをスローすること。
 */
describe('Property 1: アクセス制御 — imageKey プレフィックス不一致時の拒否', () => {
  /** スラッシュを含まない空でない文字列を生成する arbitrary */
  const nonEmptySegmentArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.includes('/'));

  it('imageKey プレフィックスが sub と一致しない場合、エラーをスローする', () => {
    fc.assert(
      fc.property(
        nonEmptySegmentArb,
        nonEmptySegmentArb,
        fc.string({ minLength: 0, maxLength: 50 }),
        (sub, otherSub, suffix) => {
          // sub と otherSub が異なることを保証
          fc.pre(sub !== otherSub);

          // otherSub をプレフィックスとした imageKey を構築（sub と不一致）
          const imageKey = `${otherSub}/${suffix}`;

          expect(() => validateImageKeyAccess(sub, imageKey)).toThrowError(
            "Unauthorized: cannot access other user's images",
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('imageKey プレフィックスが sub と一致する場合、エラーをスローしない', () => {
    fc.assert(
      fc.property(
        nonEmptySegmentArb,
        fc.string({ minLength: 0, maxLength: 50 }),
        (sub, suffix) => {
          const imageKey = `${sub}/${suffix}`;

          expect(() => validateImageKeyAccess(sub, imageKey)).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('imageKey にスラッシュが含まれない場合、エラーをスローする', () => {
    fc.assert(
      fc.property(
        nonEmptySegmentArb,
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.includes('/')),
        (sub, imageKey) => {
          expect(() => validateImageKeyAccess(sub, imageKey)).toThrowError(
            "Unauthorized: cannot access other user's images",
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
