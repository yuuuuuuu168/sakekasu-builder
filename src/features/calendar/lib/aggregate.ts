import { format, parse } from 'date-fns';
import type { UnifiedRecord } from '@/features/records/types';

/** YYYY-MM-DD をローカルタイムの Date として解釈する（UTC ずれ回避） */
export function parseDateKey(dateKey: string): Date {
  return parse(dateKey, 'yyyy-MM-dd', new Date());
}

/** Date をローカルタイムの YYYY-MM-DD に変換する */
export function formatDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/** 日付キー（YYYY-MM-DD）→ その日の記録一覧 */
export function groupRecordsByDate(records: UnifiedRecord[]): Map<string, UnifiedRecord[]> {
  const map = new Map<string, UnifiedRecord[]>();
  for (const record of records) {
    const list = map.get(record.date);
    if (list) {
      list.push(record);
    } else {
      map.set(record.date, [record]);
    }
  }
  return map;
}

/** カレンダーの modifiers に渡す「買った日」「飲んだ日」のユニークな Date 配列を作る */
export function collectMarkedDates(records: UnifiedRecord[]): {
  purchased: Date[];
  drank: Date[];
} {
  const purchased = new Set<string>();
  const drank = new Set<string>();
  for (const record of records) {
    (record.type === 'purchase' ? purchased : drank).add(record.date);
  }
  return {
    purchased: [...purchased].map(parseDateKey),
    drank: [...drank].map(parseDateKey),
  };
}

/** 指定した月の「飲んだ日数」「買った日数」（同日複数記録は1日と数える） */
export function countMonthlyRecordDays(
  records: UnifiedRecord[],
  month: Date
): { drinkingDays: number; purchaseDays: number } {
  const monthPrefix = format(month, 'yyyy-MM');
  const purchased = new Set<string>();
  const drank = new Set<string>();
  for (const record of records) {
    if (!record.date.startsWith(monthPrefix)) continue;
    (record.type === 'purchase' ? purchased : drank).add(record.date);
  }
  return { drinkingDays: drank.size, purchaseDays: purchased.size };
}
