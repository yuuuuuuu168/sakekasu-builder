import { useState } from 'react';
import { Amplify } from 'aws-amplify';
import outputs from '../amplify_outputs.json';
import { ThemeProvider } from '@/components/ThemeProvider';
import { Toaster } from '@/components/ui/sonner';
import { PurchaseRegistrationPage } from '@/features/purchase/components/PurchaseRegistrationPage';
import { DrinkingRegistrationPage } from '@/features/drinking/components/DrinkingRegistrationPage';
import { RecordListPage } from '@/features/records/components/RecordListPage';
import { AuthProvider, useAuth } from '@/features/auth/AuthContext';
import { AuthGuard } from '@/features/auth/components/AuthGuard';

Amplify.configure(outputs);

type Page = 'purchase' | 'drinking' | 'records';

/** ナビゲーションバー（認証情報 + ページ切り替え） */
function NavigationBar({
  currentPage,
  onPageChange,
}: {
  currentPage: Page;
  onPageChange: (page: Page) => void;
}) {
  const { user, signOut } = useAuth();

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-200 bg-white/80 backdrop-blur-md dark:border-white/10 dark:bg-dark-bg/80">
      {/* ユーザー情報 + サインアウト */}
      <div className="mx-auto flex max-w-md items-center justify-between px-4 py-2 text-xs">
        <span className="truncate text-gray-500 dark:text-gray-400">
          {user?.email ?? ''}
        </span>
        <button
          onClick={() => void signOut()}
          className="shrink-0 rounded px-2 py-1 text-sake-red transition-colors hover:bg-sake-red/10"
          data-testid="sign-out-button"
        >
          サインアウト
        </button>
      </div>

      {/* ページ切り替えタブ */}
      <div className="mx-auto flex max-w-md">
        <button
          onClick={() => onPageChange('purchase')}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
            currentPage === 'purchase'
              ? 'border-b-2 border-sake-gold text-sake-gold'
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          🛒 購入登録
        </button>
        <button
          onClick={() => onPageChange('drinking')}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
            currentPage === 'drinking'
              ? 'border-b-2 border-sake-gold text-sake-gold'
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          🍶 飲酒登録
        </button>
        <button
          onClick={() => onPageChange('records')}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
            currentPage === 'records'
              ? 'border-b-2 border-sake-gold text-sake-gold'
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          📋 記録一覧
        </button>
      </div>
    </nav>
  );
}

/** メインアプリコンテンツ（認証済みユーザー向け） */
function AppContent() {
  const [currentPage, setCurrentPage] = useState<Page>('purchase');

  return (
    <>
      <NavigationBar currentPage={currentPage} onPageChange={setCurrentPage} />

      {/* ページコンテンツ */}
      {currentPage === 'purchase' ? (
        <PurchaseRegistrationPage />
      ) : currentPage === 'drinking' ? (
        <DrinkingRegistrationPage />
      ) : (
        <RecordListPage />
      )}

      <Toaster />
    </>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AuthGuard>
          <AppContent />
        </AuthGuard>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
