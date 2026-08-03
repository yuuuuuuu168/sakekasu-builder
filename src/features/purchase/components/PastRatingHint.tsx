import type { PastRatingSummary } from '../lib/pastRatings';

interface PastRatingHintProps {
  summaries: PastRatingSummary[];
}

/**
 * 銘柄名フィールド直下に表示する過去評価リマインド。
 * マッチする飲酒記録がない場合は何も表示しない。
 */
export function PastRatingHint({ summaries }: PastRatingHintProps) {
  if (summaries.length === 0) return null;

  return (
    <div
      className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-600 dark:bg-amber-900/40"
      data-testid="past-rating-hint"
    >
      <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
        🍶 飲んだことのある銘柄です
      </p>
      <ul className="mt-1 space-y-0.5">
        {summaries.map((summary) => (
          <li
            key={summary.sakeName}
            className="text-xs text-amber-800 dark:text-amber-300"
            data-testid="past-rating-item"
          >
            {summary.sakeName}：★{summary.avgRating.toFixed(1)}（{summary.count}回・最終{' '}
            {summary.lastDate}）
          </li>
        ))}
      </ul>
    </div>
  );
}
