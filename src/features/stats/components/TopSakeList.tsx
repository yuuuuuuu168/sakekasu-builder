import type { TopSake } from '../lib/aggregate';
import { CATEGORY_FILTER_OPTIONS } from '@/features/records/types';
import { RatingMark } from '@/components/RatingMark';

interface TopSakeListProps {
  data: TopSake[];
}

/** お気に入り銘柄 TOP5（平均評価の高い順のランキングリスト） */
export function TopSakeList({ data }: TopSakeListProps) {
  if (data.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground" data-testid="top-sake-empty">
        評価つきの飲酒記録がまだありません
      </p>
    );
  }

  return (
    <ol className="divide-y divide-border" data-testid="top-sake-list">
      {data.map((sake, index) => (
        <li
          key={sake.sakeName}
          className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
          data-testid="top-sake-item"
        >
          {/* 順位は塗りのバッジにせず、数字のまま置く */}
          <span className="w-4 shrink-0 text-right text-sm font-semibold text-muted-foreground tabular-nums">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {sake.sakeName}
            </p>
            <p className="text-xs text-muted-foreground">
              {CATEGORY_FILTER_OPTIONS.find((o) => o.value === sake.category)?.label ?? sake.category}
              ・{sake.count}回
            </p>
          </div>
          <span className="shrink-0 text-sm font-medium text-foreground" data-testid="top-sake-rating">
            <RatingMark value={sake.avgRating.toFixed(1)} />
          </span>
        </li>
      ))}
    </ol>
  );
}
