import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useRecordFetch } from '@/features/records/hooks/useRecordFetch';
import { LoadingState } from '@/features/records/components/LoadingState';
import { ErrorState } from '@/features/records/components/ErrorState';
import {
  aggregateMonthlyDrinking,
  aggregateCategorySpending,
  aggregateTopSakes,
} from '../lib/aggregate';
import { MonthlyDrinkingChart } from './MonthlyDrinkingChart';
import { CategorySpendingChart } from './CategorySpendingChart';
import { TopSakeList } from './TopSakeList';

/** 統計セクションの共通カード */
function StatsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-white/20 bg-white/80 p-4 shadow-sm backdrop-blur-lg dark:bg-white/5">
      <h2 className="mb-4 text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h2>
      {children}
    </section>
  );
}

export function StatsPage() {
  const { records, isLoading, error, refetch } = useRecordFetch();

  const monthlyDrinking = useMemo(() => aggregateMonthlyDrinking(records, new Date()), [records]);
  const categorySpending = useMemo(() => aggregateCategorySpending(records), [records]);
  const topSakes = useMemo(() => aggregateTopSakes(records), [records]);

  return (
    <div className="min-h-screen bg-white dark:bg-dark-bg">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        {/* Header */}
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-indigo-wa dark:text-dark-gold sm:text-2xl">
            📊 統計
          </h1>
          <ThemeToggle />
        </header>

        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : (
          <div className="space-y-6">
            <StatsCard title="月別飲酒量（直近6ヶ月）">
              <MonthlyDrinkingChart data={monthlyDrinking} />
            </StatsCard>

            <StatsCard title="カテゴリ別支出">
              <CategorySpendingChart data={categorySpending} />
            </StatsCard>

            <StatsCard title="お気に入り銘柄 TOP5">
              <TopSakeList data={topSakes} />
            </StatsCard>
          </div>
        )}
      </div>
    </div>
  );
}
