import type { MonthlyDrinkingCount } from '../lib/aggregate';

interface MonthlyDrinkingChartProps {
  data: MonthlyDrinkingCount[];
}

/** 月別飲酒量の縦棒グラフ（直近6ヶ月・単一系列） */
export function MonthlyDrinkingChart({ data }: MonthlyDrinkingChartProps) {
  const allZero = data.every((d) => d.count === 0);

  if (allZero) {
    return (
      <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400" data-testid="monthly-empty">
        この期間の飲酒記録はまだありません
      </p>
    );
  }

  const max = Math.max(...data.map((d) => d.count));

  return (
    <div className="flex items-end gap-2" data-testid="monthly-chart" role="img" aria-label="月別飲酒量の棒グラフ">
      {data.map((d) => (
        <div key={d.yearMonth} className="flex flex-1 flex-col items-center gap-1" data-testid="monthly-bar">
          <span className="h-4 text-xs font-medium text-gray-700 dark:text-gray-300" data-testid="monthly-count">
            {d.count > 0 ? d.count : ''}
          </span>
          <div className="flex h-28 w-full items-end px-1.5">
            <div
              className="w-full rounded-t bg-gold-wa dark:bg-dark-gold"
              style={{ height: `${(d.count / max) * 100}%` }}
            />
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400">{d.label}</span>
        </div>
      ))}
    </div>
  );
}
