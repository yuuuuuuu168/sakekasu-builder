// Feature: cdk-backend-auth, Property 2: パスワードポリシーバリデーション
// **Validates: Requirements 2.3**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validatePassword } from '../validation';

/**
 * パスワードの各条件を個別にチェックするヘルパー関数
 */
const hasMinLength = (s: string) => s.length >= 8;
const hasUppercase = (s: string) => /[A-Z]/.test(s);
const hasLowercase = (s: string) => /[a-z]/.test(s);
const hasDigit = (s: string) => /[0-9]/.test(s);
const hasSymbol = (s: string) => /[^A-Za-z0-9]/.test(s);

/**
 * 違反している条件の数を数える
 */
function countViolations(password: string): number {
  let count = 0;
  if (!hasMinLength(password)) count++;
  if (!hasUppercase(password)) count++;
  if (!hasLowercase(password)) count++;
  if (!hasDigit(password)) count++;
  if (!hasSymbol(password)) count++;
  return count;
}

const UPPER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER_CHARS = 'abcdefghijklmnopqrstuvwxyz';
const DIGIT_CHARS = '0123456789';
const SYMBOL_CHARS = '!@#$%^&*()-_=+[]{}|;:,.<>?/~`';
const ALL_CHARS = UPPER_CHARS + LOWER_CHARS + DIGIT_CHARS + SYMBOL_CHARS;

/**
 * 指定した文字セットからランダムな文字列を生成するヘルパー
 */
function charsFrom(charset: string, minLen: number, maxLen: number): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...charset.split('')), { minLength: minLen, maxLength: maxLen })
    .map((arr) => arr.join(''));
}

/**
 * 有効なパスワードを生成するジェネレーター
 * 大文字 + 小文字 + 数字 + 記号 + パディングで8文字以上を保証
 */
const validPasswordArb = fc
  .tuple(
    charsFrom(UPPER_CHARS, 1, 3),
    charsFrom(LOWER_CHARS, 1, 3),
    charsFrom(DIGIT_CHARS, 1, 3),
    charsFrom(SYMBOL_CHARS, 1, 3),
    charsFrom(ALL_CHARS, 4, 12),
  )
  .map(([upper, lower, digit, symbol, padding]) => {
    // 各カテゴリ最低1文字 + パディング4文字以上 = 最低8文字を保証
    const chars = (upper + lower + digit + symbol + padding).split('');
    // Fisher-Yates シャッフル（テスト用なので Math.random で十分）
    for (let i = chars.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  });

/**
 * 大文字のみのパスワード（小文字・数字・記号が欠ける）
 */
const uppercaseOnlyArb = charsFrom(UPPER_CHARS, 8, 20);

/**
 * 小文字のみのパスワード（大文字・数字・記号が欠ける）
 */
const lowercaseOnlyArb = charsFrom(LOWER_CHARS, 8, 20);

/**
 * 数字のみのパスワード（大文字・小文字・記号が欠ける）
 */
const digitsOnlyArb = charsFrom(DIGIT_CHARS, 8, 20);

describe('Property 2: パスワードポリシーバリデーション', () => {
  it('すべての条件を満たすパスワードは有効と判定される', () => {
    fc.assert(
      fc.property(validPasswordArb, (password) => {
        const result = validatePassword(password);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  it('任意の文字列に対して、少なくとも1つの条件を欠く場合は無効と判定される', () => {
    fc.assert(
      fc.property(fc.string(), (password) => {
        const violations = countViolations(password);
        const result = validatePassword(password);

        if (violations === 0) {
          expect(result.isValid).toBe(true);
          expect(result.errors).toHaveLength(0);
        } else {
          expect(result.isValid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('エラー数は違反している条件の数と一致する', () => {
    fc.assert(
      fc.property(fc.string(), (password) => {
        const violations = countViolations(password);
        const result = validatePassword(password);
        expect(result.errors).toHaveLength(violations);
      }),
      { numRuns: 100 },
    );
  });

  it('大文字のみのパスワードは小文字・数字・記号の3つのエラーを返す', () => {
    fc.assert(
      fc.property(uppercaseOnlyArb, (password) => {
        const result = validatePassword(password);
        expect(result.isValid).toBe(false);
        expect(result.errors).toHaveLength(3);
      }),
      { numRuns: 100 },
    );
  });

  it('小文字のみのパスワードは大文字・数字・記号の3つのエラーを返す', () => {
    fc.assert(
      fc.property(lowercaseOnlyArb, (password) => {
        const result = validatePassword(password);
        expect(result.isValid).toBe(false);
        expect(result.errors).toHaveLength(3);
      }),
      { numRuns: 100 },
    );
  });

  it('数字のみのパスワードは大文字・小文字・記号の3つのエラーを返す', () => {
    fc.assert(
      fc.property(digitsOnlyArb, (password) => {
        const result = validatePassword(password);
        expect(result.isValid).toBe(false);
        expect(result.errors).toHaveLength(3);
      }),
      { numRuns: 100 },
    );
  });
});
