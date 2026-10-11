import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { useAuth } from '../AuthContext';
import { PORTAL_SIGN_OUT_URL } from '../amplifyConfig';
import { AuthLoading } from './AuthLoading';
import './AuthPage.css';

/** 4 アプリ共通の入口の表紙。サインアウト後の戻り先と同じ URL */
const PORTAL_TOP_URL = PORTAL_SIGN_OUT_URL;

/**
 * 未サインインのときの画面。
 *
 * サインイン・MFA・パスワードの扱いは、共通ログイン（4 アプリ共有）の
 * マネージドログイン画面が受け持つ。ここはそこへ送るだけ。
 *
 * 開いた時点で未サインインなら、ボタンを押させずにタブごとに一度だけ自動で送る
 * （autoSignIn.ts）。その間は読み込み中の表示のままにして、この画面は見せない。
 * 戻ってきてもまだ未サインイン（取り消した・`?error=` 付きで戻った等）なら、
 * 印があるので自動では送らず、入口の表紙と同じ見た目の画面とボタンを出す。
 * 行ったり来たりを繰り返さず、失敗の文言をここで読めるようにするため。
 * ボタンは印によらず必ず送る。
 *
 * この画面だけは黒に固定する（AuthPage.css）。アカウントは管理者が共通ログイン側で
 * 作る（セルフサインアップは無い）。
 */
export function AuthPage() {
  const { signIn, error, autoSignIn, takeAutoSignIn } = useAuth();
  // 自動で送るときは、この画面を一瞬見せずに読み込み中の表示で始める
  const [isAutoRedirecting, setIsAutoRedirecting] = useState(autoSignIn && !error);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const handleSignIn = useCallback(async () => {
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
      setIsAutoRedirecting(false);
    }
  }, [signIn]);

  useEffect(() => {
    // 戻りで失敗した文言があるときは送らない。takeAutoSignIn は一度しか
    // true を返さないので、画面を出し直しても送り直さない
    if (error || !takeAutoSignIn()) return;
    void handleSignIn();
  }, [error, handleSignIn, takeAutoSignIn]);

  useEffect(() => {
    // マネージドログインから戻るボタンで帰ってくると、iOS Safari などは移る直前の
    // 画面（移動中のまま）を履歴のキャッシュから戻す。そのときはボタンを押せる状態に戻す
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setIsRedirecting(false);
      setIsAutoRedirecting(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  useEffect(() => {
    // この画面を出している間だけ <html> の地も黒にする（AuthPage.css）
    const root = document.documentElement;
    root.classList.add('signin-active');
    return () => root.classList.remove('signin-active');
  }, []);

  if (isAutoRedirecting) {
    return <AuthLoading />;
  }

  const message = startError ?? error;

  return (
    <main className="signin-cover" data-testid="auth-page">
      <div className="signin-mark" aria-hidden="true">
        🍶
      </div>
      <h1 className="signin-title">酒カス</h1>
      <div className="signin-rule" aria-hidden="true">
        ◆
      </div>
      <p className="signin-lead">日本酒の記録</p>
      <button
        type="button"
        className="signin-btn"
        data-testid="signin-submit"
        disabled={isRedirecting}
        onClick={() => void handleSignIn()}
      >
        {isRedirecting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            移動中...
          </>
        ) : (
          'パスキーでログイン'
        )}
      </button>
      <p className="signin-note">共通ログインの画面へ移動します</p>
      {message && (
        <p data-testid="signin-error" className="signin-error" role="alert">
          {message}
        </p>
      )}
      <a className="signin-back" href={PORTAL_TOP_URL}>
        ← sakekasu の入口へ
      </a>
    </main>
  );
}
