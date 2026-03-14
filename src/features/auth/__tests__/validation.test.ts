import { describe, it, expect } from 'vitest';
import { validatePassword } from '../validation';
import type { PasswordValidationResult } from '../validation';

describe('validatePassword', () => {
  it('すべての条件を満たすパスワードは有効と判定される', () => {
    const result: PasswordValidationResult = validatePassword('Abcdef1!');
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('8文字未満のパスワードはエラーを返す', () => {
    const result = validatePassword('Ab1!xyz');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('8文字以上で入力してください');
  });

  it('大文字を含まないパスワードはエラーを返す', () => {
    const result = validatePassword('abcdef1!');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('大文字を含めてください');
  });

  it('小文字を含まないパスワードはエラーを返す', () => {
    const result = validatePassword('ABCDEF1!');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('小文字を含めてください');
  });

  it('数字を含まないパスワードはエラーを返す', () => {
    const result = validatePassword('Abcdefg!');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('数字を含めてください');
  });

  it('記号を含まないパスワードはエラーを返す', () => {
    const result = validatePassword('Abcdefg1');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('記号を含めてください');
  });

  it('空文字列はすべてのエラーを返す', () => {
    const result = validatePassword('');
    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(5);
    expect(result.errors).toContain('8文字以上で入力してください');
    expect(result.errors).toContain('大文字を含めてください');
    expect(result.errors).toContain('小文字を含めてください');
    expect(result.errors).toContain('数字を含めてください');
    expect(result.errors).toContain('記号を含めてください');
  });

  it('複数の条件を同時に満たさない場合、該当するすべてのエラーを返す', () => {
    const result = validatePassword('abc');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('8文字以上で入力してください');
    expect(result.errors).toContain('大文字を含めてください');
    expect(result.errors).toContain('数字を含めてください');
    expect(result.errors).toContain('記号を含めてください');
    expect(result.errors).not.toContain('小文字を含めてください');
  });
});
