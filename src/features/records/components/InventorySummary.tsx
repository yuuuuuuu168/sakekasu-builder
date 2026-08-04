import { useMemo } from 'react';
import type { UnifiedRecord } from '../types';
import { summarizeInventory } from '../lib/inventorySummary';

/** カテゴリごとのアイコン */
const CATEGORY_ICONS: Record<string, string> = {
  WHISKY: '\u{1F943}', // 🥃
  NIHONSHU: '\u{1F376}', // 🍶
};

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
      className="flex flex-wrap items-center gap-2 rounded-xl border border-white/20 bg-white/80 px-4 py-3 shadow-sm backdrop-blur-lg dark:bg-white/5"
      data-testid="inventory-summary"
    >
      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">在庫</span>
      {summaries.map((summary) => (
        <span
          key={summary.category}
          className="flex items-baseline gap-1 rounded-lg bg-gray-100 px-2.5 py-1 dark:bg-gray-800"
          data-testid={`inventory-${summary.category}`}
        >
          <span className="text-sm">{CATEGORY_ICONS[summary.category] ?? ''}</span>
          <span className="text-sm text-gray-600 dark:text-gray-300">{summary.label}</span>
          <span className="text-base font-bold text-indigo-wa dark:text-dark-gold">
            {summary.total}
          </span>
          <span className="text-xs text-gray-600 dark:text-gray-300">本</span>
          {summary.inProgress > 0 && (
            <span
              className="text-xs text-amber-700 dark:text-amber-400"
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
