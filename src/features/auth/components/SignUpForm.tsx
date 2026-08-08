import { useState, useMemo, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Check, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/AuthContext';
import { validatePassword, PASSWORD_CONDITIONS } from '@/features/auth/validation';

const MotionButton = motion.create(Button);

interface SignUpFormProps {
  onSwitchToSignIn: () => void;
  onNeedConfirmation: (email: string) => void;
}

export function SignUpForm({ onSwitchToSignIn, onNeedConfirmation }: SignUpFormProps) {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validation = useMemo(() => validatePassword(password), [password]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!validation.isValid) {
      setError('パスワードがポリシーを満たしていません');
      return;
    }

    setIsSubmitting(true);

    try {
      await signUp(email, password);
      onNeedConfirmation(email);
    } catch (err: unknown) {
      const errorName = (err as { name?: string })?.name ?? '';

      if (errorName === 'UsernameExistsException') {
        setError('このメールアドレスは既に登録されています');
      } else if (errorName === 'InvalidPasswordException') {
        setError('パスワードがポリシーを満たしていません');
      } else {
        setError('アカウント作成に失敗しました。もう一度お試しください');
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
      <form onSubmit={handleSubmit} className="space-y-5" data-testid="signup-form">
        {/* メールアドレス */}
        <div className="space-y-1.5">
          <label htmlFor="signup-email" className="text-sm font-medium text-foreground">
            メールアドレス
          </label>
          <Input
            id="signup-email"
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
          <label htmlFor="signup-password" className="text-sm font-medium text-foreground">
            パスワード
          </label>
          <Input
            id="signup-password"
            data-testid="input-password"
            type="password"
            placeholder="パスワードを入力"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
          />

          {/* パスワードバリデーション表示 */}
          {password.length > 0 && (
            <motion.ul
              data-testid="password-conditions"
              className="mt-2 space-y-1"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              transition={{ duration: 0.2 }}
            >
              {PASSWORD_CONDITIONS.map((condition) => {
                const met = condition.test(password);
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
            data-testid="signup-error"
            className="text-sm text-destructive"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            transition={{ duration: 0.2 }}
            role="alert"
          >
            {error}
          </motion.p>
        )}

        {/* アカウント作成ボタン */}
        <MotionButton
          type="submit"
          data-testid="signup-submit"
          disabled={isSubmitting}
          className="w-full h-10 text-base font-semibold bg-gold-wa text-white hover:bg-gold-wa/80"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              作成中...
            </>
          ) : (
            '🍶 アカウント作成'
          )}
        </MotionButton>

        {/* サインインへの切り替え */}
        <p className="text-center text-sm text-muted-foreground">
          すでにアカウントをお持ちの方は
          <button
            type="button"
            data-testid="switch-to-signin"
            onClick={onSwitchToSignIn}
            className="ml-1 text-gold-wa underline underline-offset-4 hover:text-gold-wa/80 transition-colors"
          >
            こちら
          </button>
        </p>
      </form>
    </motion.div>
  );
}
