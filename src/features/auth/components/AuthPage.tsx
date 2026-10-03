import { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useAuth } from '../AuthContext';

const MotionButton = motion.create(Button);

/**
 * 未サインインのときの画面。
 *
 * サインイン・MFA・パスワードの扱いは、共通ログイン（4 アプリ共有）の
 * マネージドログイン画面が受け持つ。ここはそこへ送るボタンだけを置く。
 * 自動でリダイレクトしないのは、戻りで失敗したときに行ったり来たりを
 * 繰り返さず、失敗の文言をここで読めるようにするため。
 * アカウントは管理者が共通ログイン側で作る（セルフサインアップは無い）。
 */
export function AuthPage() {
  const { signIn, error } = useAuth();
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setIsRedirecting(true);
    setStartError(null);
    try {
      // 成功するとページごとマネージドログインへ移るので、ここへは戻らない
      await signIn();
    } catch (err) {
      console.error('マネージドログインへ移れませんでした', err);
      setStartError('サインイン画面を開けませんでした。もう一度お試しください');
    } finally {
      setIsRedirecting(false);
    }
  };

  const message = startError ?? error;

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-background px-4"
      data-testid="auth-page"
    >
      <motion.div
        className="w-full max-w-sm space-y-6 text-center"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">🍶 酒カス</h1>
          <p className="text-sm text-muted-foreground">サインイン</p>
        </div>

        {message && (
          <p data-testid="signin-error" className="text-sm text-destructive" role="alert">
            {message}
          </p>
        )}

        <MotionButton
          type="button"
          data-testid="signin-submit"
          disabled={isRedirecting}
          onClick={() => void handleSignIn()}
          className="w-full h-10 text-base font-semibold bg-gold-wa text-white hover:bg-gold-wa/80"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          {isRedirecting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              サインイン画面へ移動中...
            </>
          ) : (
            '🍶 サインイン'
          )}
        </MotionButton>

        <p className="text-xs text-muted-foreground">
          共通ログインの画面へ移動します。二段階認証のコードもそちらで入力します
        </p>
      </motion.div>
    </div>
  );
}
