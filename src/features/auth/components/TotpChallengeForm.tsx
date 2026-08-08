import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/AuthContext';
import { TOTP_CODE_PATTERN } from '@/features/auth/validation';

const MotionButton = motion.create(Button);

interface TotpChallengeFormProps {
  /** サインイン画面へ戻る（チャレンジを中断したときに使う） */
  onBackToSignIn: () => void;
}

/**
 * サインイン時の TOTP コード入力フォーム
 * MFA を有効にした利用者が、認証アプリの 6 桁コードで本人確認する
 */
export function TotpChallengeForm({ onBackToSignIn }: TotpChallengeFormProps) {
  const { confirmSignInWithTotp } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    // 形式外の入力を Cognito に送るとチャレンジの試行回数だけを消費する
    if (!TOTP_CODE_PATTERN.test(code)) {
      setError('確認コードは 6 桁の数字で入力してください');
      return;
    }

    setIsSubmitting(true);

    try {
      await confirmSignInWithTotp(code);
    } catch (err: unknown) {
      const errorName = (err as { name?: string })?.name ?? '';

      if (errorName === 'CodeMismatchException') {
        setError('確認コードが正しくありません');
      } else if (errorName === 'SignInException' || errorName === 'NotAuthorizedException') {
        // Cognito のチャレンジは約 3 分で失効する。失効後はコードを
        // 入れ直しても通らないため、サインインからやり直してもらう
        setError('セッションの有効期限が切れました。もう一度サインインしてください');
      } else {
        setError('確認に失敗しました。もう一度お試しください');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      <form onSubmit={handleSubmit} className="space-y-5" data-testid="totp-challenge-form">
        <p className="text-sm text-muted-foreground" data-testid="totp-info">
          認証アプリに表示されている 6 桁のコードを入力してください
        </p>

        <div className="space-y-1.5">
          <label htmlFor="totp-code" className="text-sm font-medium text-foreground">
            確認コード
          </label>
          <Input
            id="totp-code"
            data-testid="input-totp-code"
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            autoComplete="one-time-code"
            autoFocus
          />
        </div>

        {error && (
          <motion.p
            data-testid="totp-error"
            className="text-sm text-destructive"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            transition={{ duration: 0.2 }}
            role="alert"
          >
            {error}
          </motion.p>
        )}

        <MotionButton
          type="submit"
          data-testid="totp-submit"
          disabled={isSubmitting}
          className="w-full h-10 text-base font-semibold bg-gold-wa text-white hover:bg-gold-wa/80"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              確認中...
            </>
          ) : (
            '確認する'
          )}
        </MotionButton>

        <p className="text-center text-sm text-muted-foreground">
          <button
            type="button"
            data-testid="totp-back-to-signin"
            onClick={onBackToSignIn}
            className="text-gold-wa underline underline-offset-4 hover:text-gold-wa/80 transition-colors"
          >
            サインインからやり直す
          </button>
        </p>
      </form>
    </motion.div>
  );
}
