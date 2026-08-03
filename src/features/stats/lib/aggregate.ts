import type { UnifiedRecord } from '@/features/records/types';
import { CATEGORY_FILTER_OPTIONS } from '@/features/records/types';
import type { SakeCategory } from '@/features/purchase/types';

/** 月別飲酒量の集計結果（1ヶ月分） */
export interface MonthlyDrinkingCount {
  yearMonth: string; // 'YYYY-MM'
  label: string; // '3月' など表示用
  count: number;
}

/** カテゴリ別支出の集計結果（1カテゴリ分） */
export interface CategorySpending {
  category: SakeCategory;
  label: string;
  amount: number;
}

/** お気に入り銘柄の集計結果（1銘柄分） */
export interface TopSake {
  sakeName: string;
  category: SakeCategory;
  avgRating: number;
  count: number;
}

/** カテゴリ値から日本語ラベルを取得 */
function getCategoryLabel(category: SakeCategory): string {
  return CATEGORY_FILTER_OPTIONS.find((o) => o.value === category)?.label ?? category;
}

/**
 * 直近 months ヶ月（当月含む）の飲酒記録数を月別に集計する。
 * 記録がない月も count: 0 で含める（古い月 → 新しい月の順）。
 */
export function aggregateMonthlyDrinking(
  records: UnifiedRecord[],
  now: Date,
  months = 6,
): MonthlyDrinkingCount[] {
  const buckets: MonthlyDrinkingCount[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    buckets.push({ yearMonth, label: `${d.getMonth() + 1}月`, count: 0 });
  }

  const byMonth = new Map(buckets.map((b) => [b.yearMonth, b]));
  for (const record of records) {
    if (record.type !== 'drinking') continue;
    const bucket = byMonth.get(record.date.slice(0, 7));
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

/**
 * 購入記録の価格をカテゴリ別に合計する（金額の大きい順）。
 * 支出のないカテゴリは含めない。飲酒記録の価格は外飲み等で
 * 購入記録と重複しうるため集計対象外。
 */
export function aggregateCategorySpending(records: UnifiedRecord[]): CategorySpending[] {
  const totals = new Map<SakeCategory, number>();
  for (const record of records) {
    if (record.type !== 'purchase' || record.price == null) continue;
    totals.set(record.category, (totals.get(record.category) ?? 0) + record.price);
  }
  return [...totals.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([category, amount]) => ({ category, label: getCategoryLabel(category), amount }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * 飲酒記録を銘柄ごとにまとめ、平均評価の高い順に上位 limit 件を返す。
 * 同率の場合は飲んだ回数が多い順 → 銘柄名順。評価のない記録は対象外。
 */
export function aggregateTopSakes(records: UnifiedRecord[], limit = 5): TopSake[] {
  const groups = new Map<string, { sum: number; count: number; category: SakeCategory }>();
  for (const record of records) {
    if (record.type !== 'drinking' || record.rating == null || record.rating <= 0) continue;
    const group = groups.get(record.sakeName) ?? { sum: 0, count: 0, category: record.category };
    group.sum += record.rating;
    group.count += 1;
    groups.set(record.sakeName, group);
  }
  return [...groups.entries()]
    .map(([sakeName, g]) => ({
      sakeName,
      category: g.category,
      avgRating: g.sum / g.count,
      count: g.count,
    }))
    .sort(
      (a, b) =>
        b.avgRating - a.avgRating ||
        b.count - a.count ||
        a.sakeName.localeCompare(b.sakeName, 'ja'),
    )
    .slice(0, limit);
}
