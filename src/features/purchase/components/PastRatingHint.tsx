import type { PastRatingSummary } from '../lib/pastRatings';
import { RatingMark } from '@/components/RatingMark';

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
      className="mt-2 rounded-lg border border-border bg-muted px-3 py-2"
      data-testid="past-rating-hint"
    >
      <p className="text-xs font-semibold text-foreground">
        飲んだことのある銘柄です
      </p>
      <ul className="mt-1 space-y-0.5">
        {summaries.map((summary) => (
          <li
            key={summary.sakeName}
            className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-2 tabular-nums"
            data-testid="past-rating-item"
          >
            <span>{summary.sakeName}</span>
            <RatingMark value={summary.avgRating.toFixed(1)} />
            <span className="text-muted-foreground">
              {summary.count}回・最終 {summary.lastDate}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
