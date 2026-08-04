import type { SakeCategory } from '@/features/purchase/types';
import type { UnifiedRecord } from '../types';
import { CATEGORY_FILTER_OPTIONS } from '../types';

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

/** 本数を安全に取り出す（未設定・不正値は1本扱い） */
function toBottleCount(quantity: number | undefined): number {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity)) return 1;
  const floored = Math.floor(quantity);
  return floored > 0 ? floored : 0;
}

/**
 * 購入記録から在庫本数を集計する純粋関数。
 *
 * 「在庫あり」は飲みきり（FINISHED）以外の購入記録とし、未開封と飲み中の内訳も返す。
 * 本数はステータス単位ではなく記録単位で管理しているため、
 * 1件の購入記録の本数はすべてその記録のステータスとして数える。
 */
export function summarizeInventory(records: UnifiedRecord[]): InventoryCategorySummary[] {
  return INVENTORY_CATEGORIES.map((category) => {
    let notStarted = 0;
    let inProgress = 0;

    for (const record of records) {
      if (record.type !== 'purchase' || record.category !== category) continue;
      // drinkingStatus 未設定の古い記録は未開封として扱う
      const status = record.drinkingStatus ?? 'NOT_STARTED';
      if (status === 'FINISHED') continue;

      const count = toBottleCount(record.quantity);
      if (status === 'IN_PROGRESS') {
        inProgress += count;
      } else {
        notStarted += count;
      }
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
