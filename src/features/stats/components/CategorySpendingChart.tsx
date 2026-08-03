import type { CategorySpending } from '../lib/aggregate';

interface CategorySpendingChartProps {
  data: CategorySpending[];
}

/** カテゴリ別支出の横棒グラフ（金額の大きい順・単一系列） */
export function CategorySpendingChart({ data }: CategorySpendingChartProps) {
  if (data.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400" data-testid="spending-empty">
        購入記録がまだありません
      </p>
    );
  }

  const max = Math.max(...data.map((d) => d.amount));

  return (
    <div className="space-y-2.5" data-testid="spending-chart" role="img" aria-label="カテゴリ別支出の棒グラフ">
      {data.map((d) => (
        <div key={d.category} className="flex items-center gap-2" data-testid="spending-row">
          <span className="w-16 shrink-0 text-xs text-gray-600 dark:text-gray-400">{d.label}</span>
          <div className="h-4 flex-1">
            <div
              className="h-full rounded-r bg-gold-wa dark:bg-dark-gold"
              style={{ width: `${(d.amount / max) * 100}%`, minWidth: '3px' }}
            />
          </div>
          <span
            className="w-20 shrink-0 text-right text-xs font-medium text-gray-900 dark:text-gray-100"
            data-testid="spending-amount"
          >
            ¥{d.amount.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}
