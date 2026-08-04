import type { UnifiedRecord } from '../types';

export interface LinkedDrinkingSummary {
  /** 紐づいた飲酒記録の件数 */
  count: number;
  /** 評価の平均（小数第1位まで）。評価なしのみの場合は null */
  averageRating: number | null;
  /** 最新（飲んだ日が最も新しい）の記録のメモ */
  latestMemo?: string;
  /** 最新の記録の飲んだ日 */
  latestDate?: string;
}

/**
 * 飲酒記録を purchaseRecordId ごとに集計し、購入記録から感想を逆引きできる索引を作る。
 *
 * 「最新」は飲んだ日で比較し、同日なら作成日時が新しい方を採用する。
 */
export function buildLinkedDrinkingIndex(
  records: UnifiedRecord[],
): Map<string, LinkedDrinkingSummary> {
  const grouped = new Map<string, UnifiedRecord[]>();

  for (const record of records) {
    if (record.type !== 'drinking') continue;
    const purchaseId = record.purchaseRecordId;
    if (!purchaseId) continue;
    const list = grouped.get(purchaseId);
    if (list) {
      list.push(record);
    } else {
      grouped.set(purchaseId, [record]);
    }
  }

  const index = new Map<string, LinkedDrinkingSummary>();

  for (const [purchaseId, list] of grouped) {
    const ratings = list
      .map((r) => r.rating)
      .filter((r): r is number => typeof r === 'number' && r > 0);

    const latest = list.reduce((a, b) => (isNewer(b, a) ? b : a));

    index.set(purchaseId, {
      count: list.length,
      averageRating:
        ratings.length > 0
          ? Math.round((ratings.reduce((sum, r) => sum + r, 0) / ratings.length) * 10) / 10
          : null,
      latestMemo: latest.memo || undefined,
      latestDate: latest.date,
    });
  }

  return index;
}

/** b より a の方が新しいか（飲んだ日 → 作成日時の順で比較） */
function isNewer(a: UnifiedRecord, b: UnifiedRecord): boolean {
  if (a.date !== b.date) return a.date > b.date;
  return a.createdAt > b.createdAt;
}
