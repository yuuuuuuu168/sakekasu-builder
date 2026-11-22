import { ThemeToggle } from '@/components/ThemeToggle';
import { PurchaseForm } from '@/features/purchase/components/PurchaseForm';

export function PurchaseRegistrationPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-md px-4 pt-6 pb-24 sm:pt-10">
        {/* Header */}
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-primary sm:text-2xl">
            購入したお酒を登録
          </h1>
          <ThemeToggle />
        </header>

        {/* 入力フォーム */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <PurchaseForm />
        </div>
      </div>
    </div>
  );
}
