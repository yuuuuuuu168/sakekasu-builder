import { useCallback, useState } from 'react';
import { Amplify } from 'aws-amplify';
import outputs from '../amplify_outputs.json';
import { ThemeProvider } from '@/components/ThemeProvider';
import { Toaster } from '@/components/ui/sonner';
import { PurchaseRegistrationPage } from '@/features/purchase/components/PurchaseRegistrationPage';
import { DrinkingRegistrationPage } from '@/features/drinking/components/DrinkingRegistrationPage';
import { RecordListPage } from '@/features/records/components/RecordListPage';
import { StatsPage } from '@/features/stats/components/StatsPage';
import { SommelierChat } from '@/features/sommelier/components/SommelierChat';
import { AuthProvider, useAuth } from '@/features/auth/AuthContext';
import { AuthGuard } from '@/features/auth/components/AuthGuard';
import type { StockDrinkDraft } from '@/features/drinking/types';
import type { UnifiedRecord } from '@/features/records/types';

Amplify.configure(outputs);

type Page = 'purchase' | 'drinking' | 'records' | 'stats';

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
        {(
          [
            { page: 'purchase', label: '🛒 購入登録' },
            { page: 'drinking', label: '🍶 飲酒登録' },
            { page: 'records', label: '📋 記録一覧' },
            { page: 'stats', label: '📊 統計' },
          ] as const
        ).map(({ page, label }) => (
          <button
            key={page}
            onClick={() => onPageChange(page)}
            className={`flex-1 whitespace-nowrap px-1 py-3 text-sm font-medium transition-colors ${
              currentPage === page
                ? 'border-b-2 border-sake-gold text-sake-gold'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </nav>
  );
}

/** メインアプリコンテンツ（認証済みユーザー向け） */
function AppContent() {
  const [currentPage, setCurrentPage] = useState<Page>('purchase');
  // 在庫（購入記録）から飲酒登録へ引き継ぐ情報
  const [stockDraft, setStockDraft] = useState<StockDrinkDraft | null>(null);
  // 新しい在庫を選び直したときだけフォームを作り直すためのキー。
  // 紐づけ解除では変えないので、入力済みの内容は消えない
  const [stockDraftKey, setStockDraftKey] = useState(0);

  const handleDrinkFromStock = useCallback((record: UnifiedRecord) => {
    setStockDraft({
      purchaseRecordId: record.id,
      sakeName: record.sakeName,
      category: record.category,
      drinkingStatus: record.drinkingStatus ?? 'NOT_STARTED',
    });
    setStockDraftKey((key) => key + 1);
    setCurrentPage('drinking');
  }, []);

  const handleStockDraftClear = useCallback(() => {
    setStockDraft(null);
  }, []);

  return (
    <>
      <NavigationBar currentPage={currentPage} onPageChange={setCurrentPage} />

      {/* ページコンテンツ */}
      {currentPage === 'purchase' ? (
        <PurchaseRegistrationPage />
      ) : currentPage === 'drinking' ? (
        <DrinkingRegistrationPage
          key={stockDraftKey}
          stockDraft={stockDraft}
          onStockDraftClear={handleStockDraftClear}
        />
      ) : currentPage === 'records' ? (
        <RecordListPage onDrinkFromStock={handleDrinkFromStock} />
      ) : (
        <StatsPage />
      )}

      {/* どの画面からでも相談できるようページ切り替えの外に置く */}
      <SommelierChat />

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
