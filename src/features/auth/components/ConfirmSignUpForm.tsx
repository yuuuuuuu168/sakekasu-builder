import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/AuthContext';

const MotionButton = motion.create(Button);

interface ConfirmSignUpFormProps {
  email: string;
  onConfirmed: () => void;
}

export function ConfirmSignUpForm({ email, onConfirmed }: ConfirmSignUpFormProps) {
  const { confirmSignUp } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await confirmSignUp(email, code);
      onConfirmed();
    } catch (err: unknown) {
      const errorName = (err as { name?: string })?.name ?? '';

      if (errorName === 'CodeMismatchException') {
        setError('確認コードが正しくありません');
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
      <form onSubmit={handleSubmit} className="space-y-5" data-testid="confirm-form">
        {/* 案内メッセージ */}
        <p data-testid="confirm-info" className="text-sm text-muted-foreground text-center">
          {email} に確認コードを送信しました
        </p>

        {/* 確認コード */}
        <div className="space-y-1.5">
          <label htmlFor="confirm-code" className="text-sm font-medium text-foreground">
            確認コード
          </label>
          <Input
            id="confirm-code"
            data-testid="input-code"
            type="text"
            inputMode="numeric"
            placeholder="確認コードを入力"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            autoComplete="one-time-code"
          />
        </div>

        {/* エラーメッセージ */}
        {error && (
          <motion.p
            data-testid="confirm-error"
            className="text-sm text-destructive"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            transition={{ duration: 0.2 }}
            role="alert"
          >
            {error}
          </motion.p>
        )}

        {/* 確認ボタン */}
        <MotionButton
          type="submit"
          data-testid="confirm-submit"
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
            '🍶 確認'
          )}
        </MotionButton>
      </form>
    </motion.div>
  );
}
