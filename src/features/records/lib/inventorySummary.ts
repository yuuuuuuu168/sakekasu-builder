import type { SakeCategory } from '@/features/purchase/types';
import type { UnifiedRecord } from '../types';
import { CATEGORY_FILTER_OPTIONS } from '../types';
import { getBottleBreakdown } from './bottleCount';

/**
 * 在庫本数サマリーの対象カテゴリ。
 * 長期保存して手元にストックしがちなウイスキーと日本酒だけを数える。
 */
export const INVENTORY_CATEGORIES: SakeCategory[] = ['WHISKY', 'NIHONSHU'];

export interface InventoryCategorySummary {
  category: SakeCategory;
  label: string;
  /** 未開封 + 飲み中の合計本数 */
  total: number;
  notStarted: number;
  inProgress: number;
}

/**
 * 購入記録から在庫本数を集計する純粋関数。
 *
 * 数えるのは記録ごとの残本数（まだ飲みきっていない本数）で、
 * そのうち開封している1本を飲み中、残りを未開封として内訳に分ける。
 * まとめ買いした3本のうち1本を開けた記録なら「飲み中1本・未開封2本」になる。
 */
export function summarizeInventory(records: UnifiedRecord[]): InventoryCategorySummary[] {
  return INVENTORY_CATEGORIES.map((category) => {
    let notStarted = 0;
    let inProgress = 0;

    for (const record of records) {
      if (record.type !== 'purchase' || record.category !== category) continue;

      const breakdown = getBottleBreakdown(record);
      notStarted += breakdown.notStarted;
      inProgress += breakdown.inProgress;
    }

    return {
      category,
      label: getCategoryLabel(category),
      total: notStarted + inProgress,
      notStarted,
      inProgress,
    };
  });
}

/** カテゴリ値から日本語ラベルを取得 */
function getCategoryLabel(category: SakeCategory): string {
  return CATEGORY_FILTER_OPTIONS.find((o) => o.value === category)?.label ?? category;
}
