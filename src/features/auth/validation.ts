/**
 * パスワードバリデーション
 * Cognito UserPool のパスワードポリシーに対応するクライアントサイドバリデーション
 */

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

/** パスワード条件の定義（入力中のチェックリスト表示用） */
export const PASSWORD_CONDITIONS = [
  { test: (p: string) => p.length >= 8, label: '8文字以上' },
  { test: (p: string) => /[A-Z]/.test(p), label: '大文字を含む' },
  { test: (p: string) => /[a-z]/.test(p), label: '小文字を含む' },
  { test: (p: string) => /[0-9]/.test(p), label: '数字を含む' },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p), label: '記号を含む' },
] as const;

/**
 * パスワードが Cognito のパスワードポリシーを満たすかチェックする純粋関数
 *
 * 条件:
 * - 8文字以上
 * - 大文字を含む
 * - 小文字を含む
 * - 数字を含む
 * - 記号を含む
 */
export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('8文字以上で入力してください');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('大文字を含めてください');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('小文字を含めてください');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('数字を含めてください');
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('記号を含めてください');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
