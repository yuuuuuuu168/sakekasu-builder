import { ThemeToggle } from '@/components/ThemeToggle';
import { DrinkingForm } from '@/features/drinking/components/DrinkingForm';
import type { StockDrinkDraft } from '@/features/drinking/types';

interface DrinkingRegistrationPageProps {
  /** 在庫（購入記録）から遷移してきた場合の紐づけ情報 */
  stockDraft?: StockDrinkDraft | null;
  /** 登録完了・紐づけ解除で紐づけを外すときの通知 */
  onStockDraftClear?: () => void;
}

export function DrinkingRegistrationPage({
  stockDraft,
  onStockDraftClear,
}: DrinkingRegistrationPageProps = {}) {
  return (
    <div className="min-h-screen bg-white dark:bg-dark-bg">
      <div className="mx-auto max-w-md px-4 py-8 sm:py-12">
        {/* Header */}
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-indigo-wa dark:text-dark-gold sm:text-2xl">
            🍶 飲んだお酒を登録
          </h1>
          <ThemeToggle />
        </header>

        {/* Glassmorphism Card */}
        <div className="rounded-xl border border-white/20 bg-white/80 p-6 shadow-lg backdrop-blur-lg dark:bg-white/5">
          <DrinkingForm stockDraft={stockDraft} onStockDraftClear={onStockDraftClear} />
        </div>
      </div>
    </div>
  );
}
