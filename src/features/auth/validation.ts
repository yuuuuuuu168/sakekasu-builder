/**
 * パスワードバリデーション
 * Cognito UserPool のパスワードポリシーに対応するクライアントサイドバリデーション
 */

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

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
