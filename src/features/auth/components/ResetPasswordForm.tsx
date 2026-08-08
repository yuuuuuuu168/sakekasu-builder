import { useState, useMemo, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Check, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/AuthContext';
import { validatePassword, PASSWORD_CONDITIONS } from '@/features/auth/validation';

const MotionButton = motion.create(Button);

/** リセットフローの進行状態 */
type ResetStep = 'request' | 'confirm' | 'done';

interface ResetPasswordFormProps {
  /** サインイン画面で入力済みのメールアドレス（引き継ぎ用） */
  initialEmail: string;
  /** 管理者リセット（RESET_REQUIRED）でサインインから誘導されたとき true */
  resetRequired: boolean;
  onBackToSignIn: () => void;
}

export function ResetPasswordForm({
  initialEmail,
  resetRequired,
  onBackToSignIn,
}: ResetPasswordFormProps) {
  const { resetPassword, confirmResetPassword } = useAuth();
  const [step, setStep] = useState<ResetStep>('request');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validation = useMemo(() => validatePassword(newPassword), [newPassword]);

  const handleRequest = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await resetPassword(email);
      setStep('confirm');
    } catch (err: unknown) {
      const errorName = (err as { name?: string })?.name ?? '';

      if (errorName === 'LimitExceededException') {
        setError('試行回数が上限に達しました。しばらく時間をおいてお試しください');
      } else {
        setError('コードの送信に失敗しました。もう一度お試しください');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirm = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!validation.isValid) {
      setError('パスワードがポリシーを満たしていません');
      return;
    }

    setIsSubmitting(true);

    try {
      await confirmResetPassword(email, code, newPassword);
      setStep('done');
    } catch (err: unknown) {
      const errorName = (err as { name?: string })?.name ?? '';

      if (errorName === 'CodeMismatchException') {
        setError('確認コードが正しくありません');
      } else if (errorName === 'ExpiredCodeException') {
        setError('確認コードの有効期限が切れています。コードを再送信してください');
      } else if (errorName === 'InvalidPasswordException') {
        setError('パスワードがポリシーを満たしていません');
      } else if (errorName === 'LimitExceededException') {
        setError('試行回数が上限に達しました。しばらく時間をおいてお試しください');
      } else {
        setError('パスワードの再設定に失敗しました。もう一度お試しください');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  /** コードが届かない場合などにメール入力からやり直す */
  const handleBackToRequest = () => {
    setCode('');
    setNewPassword('');
    setError('');
    setStep('request');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      {step === 'request' && (
        <form onSubmit={handleRequest} className="space-y-5" data-testid="reset-request-form">
          {/* 案内メッセージ */}
          <p data-testid="reset-request-info" className="text-sm text-muted-foreground text-center">
            {resetRequired
              ? 'パスワードの再設定が必要です。登録済みのメールアドレスに確認コードを送信してください'
              : '登録済みのメールアドレスを入力してください。パスワード再設定用の確認コードを送信します'}
          </p>

          {/* メールアドレス */}
          <div className="space-y-1.5">
            <label htmlFor="reset-email" className="text-sm font-medium text-foreground">
              メールアドレス
            </label>
            <Input
              id="reset-email"
              data-testid="input-reset-email"
              type="email"
              placeholder="example@mail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          {/* エラーメッセージ */}
          {error && (
            <motion.p
              data-testid="reset-error"
              className="text-sm text-destructive"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              transition={{ duration: 0.2 }}
              role="alert"
            >
              {error}
            </motion.p>
          )}

          {/* コード送信ボタン */}
          <MotionButton
            type="submit"
            data-testid="reset-request-submit"
            disabled={isSubmitting}
            className="w-full h-10 text-base font-semibold bg-gold-wa text-white hover:bg-gold-wa/80"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                送信中...
              </>
            ) : (
              '🍶 確認コードを送信'
            )}
          </MotionButton>

          {/* サインインへ戻る */}
          <p className="text-center text-sm text-muted-foreground">
            <button
              type="button"
              data-testid="reset-back-to-signin"
              onClick={onBackToSignIn}
              className="text-gold-wa underline underline-offset-4 hover:text-gold-wa/80 transition-colors"
            >
              サインインに戻る
            </button>
          </p>
        </form>
      )}

      {step === 'confirm' && (
        <form onSubmit={handleConfirm} className="space-y-5" data-testid="reset-confirm-form">
          {/* 案内メッセージ。存在しないメールアドレスでも同じ文言になるため、
              ここから登録の有無は読み取れない */}
          <p data-testid="reset-confirm-info" className="text-sm text-muted-foreground text-center">
            {email} 宛に確認コードを送信しました。メールが届かない場合は、入力したメールアドレスをご確認ください
          </p>

          {/* 確認コード */}
          <div className="space-y-1.5">
            <label htmlFor="reset-code" className="text-sm font-medium text-foreground">
              確認コード
            </label>
            <Input
              id="reset-code"
              data-testid="input-reset-code"
              type="text"
              inputMode="numeric"
              placeholder="確認コードを入力"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoComplete="one-time-code"
            />
          </div>

          {/* 新しいパスワード */}
          <div className="space-y-1.5">
            <label htmlFor="reset-new-password" className="text-sm font-medium text-foreground">
              新しいパスワード
            </label>
            <Input
              id="reset-new-password"
              data-testid="input-reset-new-password"
              type="password"
              placeholder="新しいパスワードを入力"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
            />

            {/* パスワードバリデーション表示 */}
            {newPassword.length > 0 && (
              <motion.ul
                data-testid="password-conditions"
                className="mt-2 space-y-1"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                transition={{ duration: 0.2 }}
              >
                {PASSWORD_CONDITIONS.map((condition) => {
                  const met = condition.test(newPassword);
                  return (
                    <li
                      key={condition.label}
                      data-testid={`condition-${condition.label}`}
                      className={`flex items-center gap-1.5 text-xs ${
                        met ? 'text-green-500' : 'text-muted-foreground'
                      }`}
                    >
                      {met ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                      {condition.label}
                    </li>
                  );
                })}
              </motion.ul>
            )}
          </div>

          {/* エラーメッセージ */}
          {error && (
            <motion.p
              data-testid="reset-error"
              className="text-sm text-destructive"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              transition={{ duration: 0.2 }}
              role="alert"
            >
              {error}
            </motion.p>
          )}

          {/* 再設定ボタン */}
          <MotionButton
            type="submit"
            data-testid="reset-confirm-submit"
            disabled={isSubmitting}
            className="w-full h-10 text-base font-semibold bg-gold-wa text-white hover:bg-gold-wa/80"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                再設定中...
              </>
            ) : (
              '🍶 パスワードを再設定'
            )}
          </MotionButton>

          {/* メール入力からやり直す */}
          <p className="text-center text-sm text-muted-foreground">
            コードが届かない場合は
            <button
              type="button"
              data-testid="reset-back-to-request"
              onClick={handleBackToRequest}
              className="ml-1 text-gold-wa underline underline-offset-4 hover:text-gold-wa/80 transition-colors"
            >
              こちら
            </button>
          </p>
        </form>
      )}

      {step === 'done' && (
        <div className="space-y-5" data-testid="reset-done">
          <p data-testid="reset-done-info" className="text-sm text-muted-foreground text-center">
            パスワードを再設定しました。新しいパスワードでサインインしてください
          </p>

          <MotionButton
            type="button"
            data-testid="reset-done-to-signin"
            onClick={onBackToSignIn}
            className="w-full h-10 text-base font-semibold bg-gold-wa text-white hover:bg-gold-wa/80"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            🍶 サインインへ
          </MotionButton>
        </div>
      )}
    </motion.div>
  );
}
