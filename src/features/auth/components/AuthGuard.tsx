import type { ReactNode } from 'react';

import { useAuth } from '../AuthContext';
import { AuthPage } from './AuthPage';

interface AuthGuardProps {
  children: ReactNode;
}

/**
 * 認証ガードコンポーネント
 * 認証状態に応じてコンテンツまたは認証画面を表示するラッパー
 *
 * - 認証済み → children を表示
 * - 未認証 → AuthPage を表示
 * - ローディング中 → ローディング表示
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, isLoading } = useAuth();

  // ローディング中
  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-background"
        data-testid="auth-loading"
      >
        <div className="text-center space-y-3">
          <div className="text-3xl">🍶</div>
          <p className="text-sm text-muted-foreground">読み込み中...</p>
        </div>
      </div>
    );
  }

  // 未認証 → 認証ページを表示
  if (!isAuthenticated) {
    return <AuthPage />;
  }

  // 認証済み → children を表示
  return <>{children}</>;
}
