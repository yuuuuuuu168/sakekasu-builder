import { useCallback, useState } from 'react';
import { CalendarDays, ChartColumn, List, ShoppingBag, Wine } from 'lucide-react';
import { Amplify } from 'aws-amplify';
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
import { PortalAppsLink } from '@/features/auth/components/PortalAppsLink';
import { buildAmplifyConfig, type AppOutputs } from '@/features/auth/amplifyConfig';
import type { StockDrinkDraft } from '@/features/drinking/types';
import type { UnifiedRecord } from '@/features/records/types';

// ログインは共通ログイン（マネージドログインへのリダイレクト）。戻り先は
// いま開いているオリジンの / なので、設定はここで組み立てる
Amplify.configure(buildAmplifyConfig(outputs as AppOutputs, window.location.origin));

type Page = 'purchase' | 'drinking' | 'records' | 'calendar' | 'stats';

/** ナビゲーションバー（アプリ一覧・サインアウト + ページ切り替え） */
function NavigationBar({
  currentPage,
  onPageChange,
}: {
  currentPage: Page;
  onPageChange: (page: Page) => void;
}) {
  const { signOut } = useAuth();

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background">
      {/* 4 アプリの入口の一覧へ戻るリンクとサインアウトだけ（誰がログインしているかは出さない）。
          MFA の登録と入力は共通ログインの画面が受け持つので、ここには置かない */}
      <div className="mx-auto flex max-w-md items-center justify-end px-4 py-2 text-xs">
        <div className="flex shrink-0 items-center gap-1">
          <PortalAppsLink />
          <button
            onClick={() => void signOut()}
            className="rounded px-2 py-1 text-ink-2 transition-colors hover:bg-muted hover:text-foreground"
            data-testid="sign-out-button"
          >
            サインアウト
          </button>
        </div>
      </div>

      {/* ページ切り替えタブ。5タブを1行に並べると iPhone の幅（390〜402px）では
          最後の「統計」が画面からはみ出るので、狭い画面ではアイコンを上・ラベルを下に
          積んで5つとも収める。文字を拡大している端末向けに横スクロールは残す */}
      <div className="mx-auto flex max-w-md overflow-x-auto">
        {(
          [
            { page: 'purchase', icon: ShoppingBag, label: '購入登録' },
            { page: 'drinking', icon: Wine, label: '飲酒登録' },
            { page: 'records', icon: List, label: '記録一覧' },
            { page: 'calendar', icon: CalendarDays, label: 'カレンダー' },
            { page: 'stats', icon: ChartColumn, label: '統計' },
          ] as const
        ).map(({ page, icon: Icon, label }) => (
          <button
            key={page}
            onClick={() => onPageChange(page)}
            aria-current={currentPage === page ? 'page' : undefined}
            className={`flex flex-1 flex-col items-center gap-1 whitespace-nowrap px-0.5 py-2 text-xs leading-tight font-medium transition-colors sm:flex-row sm:justify-center sm:gap-1 sm:px-1 sm:py-3 sm:text-sm ${
              currentPage === page
                ? 'border-b-2 border-primary text-primary'
                : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="size-[18px] shrink-0 sm:size-4" strokeWidth={1.5} aria-hidden="true" />
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
