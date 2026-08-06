import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/AuthContext';

const MotionButton = motion.create(Button);

interface SignInFormProps {
  onSwitchToSignUp: () => void;
  onNeedConfirmation: (email: string) => void;
}

export function SignInForm({ onSwitchToSignUp, onNeedConfirmation }: SignInFormProps) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await signIn(email, password);
    } catch (err: unknown) {
      const errorName = (err as { name?: string })?.name ?? '';

      if (errorName === 'UserNotConfirmedException') {
        onNeedConfirmation(email);
        return;
      }

      // 「登録が無い」と「パスワードが違う」を同じ文言にして、
      // 画面から登録済みかどうかを読み取れないようにする。
      // Cognito 側でも隠しているが、設定が外れたときに備えてここでも揃えておく
      if (errorName === 'NotAuthorizedException' || errorName === 'UserNotFoundException') {
        setError('メールアドレスまたはパスワードが正しくありません');
      } else {
        // 通信断など認証情報と無関係な失敗は、原因を取り違えないよう区別する
        setError('サインインに失敗しました。もう一度お試しください');
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
      <form onSubmit={handleSubmit} className="space-y-5" data-testid="signin-form">
        {/* メールアドレス */}
        <div className="space-y-1.5">
          <label htmlFor="signin-email" className="text-sm font-medium text-foreground">
            メールアドレス
          </label>
          <Input
            id="signin-email"
            data-testid="input-email"
            type="email"
            placeholder="example@mail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>

        {/* パスワード */}
        <div className="space-y-1.5">
          <label htmlFor="signin-password" className="text-sm font-medium text-foreground">
            パスワード
          </label>
          <Input
            id="signin-password"
            data-testid="input-password"
            type="password"
            placeholder="パスワードを入力"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>

        {/* エラーメッセージ */}
        {error && (
          <motion.p
            data-testid="signin-error"
            className="text-sm text-destructive"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            transition={{ duration: 0.2 }}
            role="alert"
          >
            {error}
          </motion.p>
        )}

        {/* サインインボタン */}
        <MotionButton
          type="submit"
          data-testid="signin-submit"
          disabled={isSubmitting}
          className="w-full h-10 text-base font-semibold bg-gold-wa text-white hover:bg-gold-wa/80"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              サインイン中...
            </>
          ) : (
            '🍶 サインイン'
          )}
        </MotionButton>

        {/* サインアップへの切り替え */}
        <p className="text-center text-sm text-muted-foreground">
          アカウントをお持ちでない方は
          <button
            type="button"
            data-testid="switch-to-signup"
            onClick={onSwitchToSignUp}
            className="ml-1 text-gold-wa underline underline-offset-4 hover:text-gold-wa/80 transition-colors"
          >
            こちら
          </button>
        </p>
      </form>
    </motion.div>
  );
}
