import { useMemo } from 'react';
import type { UnifiedRecord } from '../types';
import { summarizeInventory } from '../lib/inventorySummary';

interface InventorySummaryProps {
  /** フィルタ適用前の全記録（在庫はフィルタに関係なく総量を出す） */
  records: UnifiedRecord[];
}

/**
 * 一覧上部に表示する在庫本数サマリー。
 * ウイスキーと日本酒の「未開封 + 飲み中」の本数を出す。
 * 対象カテゴリの在庫がまったく無い場合は何も表示しない。
 */
export function InventorySummary({ records }: InventorySummaryProps) {
  const summaries = useMemo(() => summarizeInventory(records), [records]);
  const hasStock = summaries.some((s) => s.total > 0);

  if (!hasStock) return null;

  return (
    <div
      className="flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-xl border border-border bg-card px-4 py-3 shadow-sm"
      data-testid="inventory-summary"
    >
      <span className="text-xs font-semibold text-muted-foreground">在庫</span>
      {summaries.map((summary) => (
        <span
          key={summary.category}
          className="flex items-baseline gap-1 tabular-nums"
          data-testid={`inventory-${summary.category}`}
        >
          <span className="text-sm text-ink-2">{summary.label}</span>
          <span className="text-lg font-bold text-foreground">
            {summary.total}
          </span>
          <span className="text-xs text-ink-2">本</span>
          {summary.inProgress > 0 && (
            <span
              className="text-xs text-gold-ink"
              data-testid={`inventory-${summary.category}-in-progress`}
            >
              （飲み中 {summary.inProgress}）
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
