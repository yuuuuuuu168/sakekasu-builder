import { useCallback, useState } from 'react';
import { Amplify } from 'aws-amplify';
import { ShieldCheck } from 'lucide-react';
import outputs from '../amplify_outputs.json';
import { ThemeProvider } from '@/components/ThemeProvider';
import { Toaster } from '@/components/ui/sonner';
import { PurchaseRegistrationPage } from '@/features/purchase/components/PurchaseRegistrationPage';
import { DrinkingRegistrationPage } from '@/features/drinking/components/DrinkingRegistrationPage';
import { RecordListPage } from '@/features/records/components/RecordListPage';
import { StatsPage } from '@/features/stats/components/StatsPage';
import { CalendarPage } from '@/features/calendar/components/CalendarPage';
import { SommelierChat } from '@/features/sommelier/components/SommelierChat';
import { AuthProvider, useAuth } from '@/features/auth/AuthContext';
import { AuthGuard } from '@/features/auth/components/AuthGuard';
import { MfaSettingsDialog } from '@/features/auth/components/MfaSettingsDialog';
import type { StockDrinkDraft } from '@/features/drinking/types';
import type { UnifiedRecord } from '@/features/records/types';

Amplify.configure(outputs);

type Page = 'purchase' | 'drinking' | 'records' | 'calendar' | 'stats';

/** ナビゲーションバー（認証情報 + ページ切り替え） */
function NavigationBar({
  currentPage,
  onPageChange,
}: {
  currentPage: Page;
  onPageChange: (page: Page) => void;
}) {
  const { signOut } = useAuth();
  const [isMfaDialogOpen, setIsMfaDialogOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-200 bg-white/80 backdrop-blur-md dark:border-white/10 dark:bg-dark-bg/80">
      {/* MFA設定 + サインアウト（誰がログインしているかは出さない） */}
      <div className="mx-auto flex max-w-md items-center justify-end px-4 py-2 text-xs">
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => setIsMfaDialogOpen(true)}
            className="flex items-center gap-1 rounded px-2 py-1 text-gray-500 transition-colors hover:bg-gray-500/10 dark:text-gray-400"
            data-testid="mfa-settings-button"
            aria-label="二段階認証の設定"
          >
            <ShieldCheck className="size-3.5" />
            MFA
          </button>
          <button
            onClick={() => void signOut()}
            className="rounded px-2 py-1 text-sake-red transition-colors hover:bg-sake-red/10"
            data-testid="sign-out-button"
          >
            サインアウト
          </button>
        </div>
      </div>

      <MfaSettingsDialog open={isMfaDialogOpen} onClose={() => setIsMfaDialogOpen(false)} />

      {/* ページ切り替えタブ。5タブを1行に並べると iPhone の幅（390〜402px）では
          最後の「統計」が画面からはみ出るので、狭い画面では絵文字を上・ラベルを下に
          積んで5つとも収める。文字を拡大している端末向けに横スクロールは残す */}
      <div className="mx-auto flex max-w-md overflow-x-auto">
        {(
          [
            { page: 'purchase', icon: '🛒', label: '購入登録' },
            { page: 'drinking', icon: '🍶', label: '飲酒登録' },
            { page: 'records', icon: '📋', label: '記録一覧' },
            { page: 'calendar', icon: '📅', label: 'カレンダー' },
            { page: 'stats', icon: '📊', label: '統計' },
          ] as const
        ).map(({ page, icon, label }) => (
          <button
            key={page}
            onClick={() => onPageChange(page)}
            className={`flex flex-1 flex-col items-center gap-0.5 whitespace-nowrap px-0.5 py-2 text-[11px] leading-tight font-medium transition-colors sm:flex-row sm:justify-center sm:gap-1 sm:px-1 sm:py-3 sm:text-sm ${
              currentPage === page
                ? 'border-b-2 border-sake-gold text-sake-gold'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <span className="text-base leading-none sm:text-sm" aria-hidden="true">
              {icon}
            </span>
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
    // 飲みきりステータスは持ち回さない。開封済みかどうかの判定は
    // markPurchaseOpened の条件式でサーバ側が行う
    setStockDraft({
      purchaseRecordId: record.id,
      sakeName: record.sakeName,
      category: record.category,
      // 写真を選ばなかったときに、購入記録の写真を複製して引き継ぐ
      imageKeys: record.imageKeys,
      // 蔵元や精米歩合は同じ酒なので打ち直させない
      specs: record.specs,
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
      ) : currentPage === 'calendar' ? (
        <CalendarPage />
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
