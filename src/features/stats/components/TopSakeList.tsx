import type { TopSake } from '../lib/aggregate';
import { CATEGORY_FILTER_OPTIONS } from '@/features/records/types';

interface TopSakeListProps {
  data: TopSake[];
}

/** 順位バッジの配色（1位はゴールドで強調） */
function rankBadgeClass(rank: number): string {
  if (rank === 1) {
    return 'bg-gold-wa text-white dark:bg-dark-gold dark:text-gray-900';
  }
  return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
}

/** お気に入り銘柄 TOP5（平均評価の高い順のランキングリスト） */
export function TopSakeList({ data }: TopSakeListProps) {
  if (data.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400" data-testid="top-sake-empty">
        評価つきの飲酒記録がまだありません
      </p>
    );
  }

  return (
    <ol className="space-y-3" data-testid="top-sake-list">
      {data.map((sake, index) => (
        <li key={sake.sakeName} className="flex items-center gap-3" data-testid="top-sake-item">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${rankBadgeClass(index + 1)}`}
          >
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {sake.sakeName}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {CATEGORY_FILTER_OPTIONS.find((o) => o.value === sake.category)?.label ?? sake.category}
              ・{sake.count}回
            </p>
          </div>
          <span className="shrink-0 text-sm font-medium text-gray-900 dark:text-gray-100" data-testid="top-sake-rating">
            <span aria-hidden="true" className="text-yellow-400">★</span> {sake.avgRating.toFixed(1)}
          </span>
        </li>
      ))}
    </ol>
  );
}
