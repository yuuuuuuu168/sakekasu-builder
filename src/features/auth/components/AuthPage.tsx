import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import { SignInForm } from './SignInForm';
import { SignUpForm } from './SignUpForm';
import { ConfirmSignUpForm } from './ConfirmSignUpForm';

/** 認証画面の表示状態 */
type AuthView = 'signIn' | 'signUp' | 'confirmSignUp';

/**
 * 認証ページコンテナ
 * SignInForm / SignUpForm / ConfirmSignUpForm を状態に応じて切り替える
 */
export function AuthPage() {
  const [view, setView] = useState<AuthView>('signIn');
  const [confirmEmail, setConfirmEmail] = useState('');

  /** サインアップ画面へ切り替え */
  const handleSwitchToSignUp = useCallback(() => {
    setView('signUp');
  }, []);

  /** サインイン画面へ切り替え */
  const handleSwitchToSignIn = useCallback(() => {
    setView('signIn');
  }, []);

  /** メール確認画面へ遷移（サインアップ後 or 未確認ユーザーのサインイン時） */
  const handleNeedConfirmation = useCallback((email: string) => {
    setConfirmEmail(email);
    setView('confirmSignUp');
  }, []);

  /** メール確認完了 → サインイン画面へ戻す */
  const handleConfirmed = useCallback(() => {
    setConfirmEmail('');
    setView('signIn');
  }, []);

  /** 現在のビューに応じたタイトル */
  const title = {
    signIn: 'サインイン',
    signUp: 'アカウント作成',
    confirmSignUp: 'メール確認',
  }[view];

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4" data-testid="auth-page">
      <div className="w-full max-w-sm space-y-6">
        {/* ヘッダー */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-foreground">🍶 酒カス</h1>
          <p className="text-sm text-muted-foreground">{title}</p>
        </div>

        {/* フォーム切り替え */}
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, x: view === 'signUp' ? 20 : -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: view === 'signUp' ? -20 : 20 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
          >
            {view === 'signIn' && (
              <SignInForm
                onSwitchToSignUp={handleSwitchToSignUp}
                onNeedConfirmation={handleNeedConfirmation}
              />
            )}
            {view === 'signUp' && (
              <SignUpForm
                onSwitchToSignIn={handleSwitchToSignIn}
                onNeedConfirmation={handleNeedConfirmation}
              />
            )}
            {view === 'confirmSignUp' && (
              <ConfirmSignUpForm
                email={confirmEmail}
                onConfirmed={handleConfirmed}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
