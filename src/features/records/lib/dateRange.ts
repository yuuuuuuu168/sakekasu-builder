import type { DateRangeFilter, RecordFilters } from '../types';

/** 記録の日付と同じ表記（YYYY-MM-DD）。文字列のまま大小比較できる */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 絞り込みに使う日付の範囲。両端とも含む。undefined はその側に上限／下限が無いことを表す */
export interface DateBounds {
  from?: string;
  to?: string;
}

/** YYYY-MM-DD 形式で、かつ実在する日付か（2026-02-31 のような値を弾く） */
export function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  );
}

/** Date をローカル時刻基準で YYYY-MM-DD にする（UTC 変換で1日ずれないように） */
export function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 月をまたいだ日付の移動。移動先の月に同じ日が無ければその月の末日に丸める
 * （5/31 の3ヶ月前は 2/28。Date に 2/31 を渡すと 3/3 へ繰り上がってしまう）
 */
function shiftMonths(date: Date, months: number): Date {
  const year = date.getFullYear();
  const month = date.getMonth() + months;
  const lastDayOfTargetMonth = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(date.getDate(), lastDayOfTargetMonth));
}

/**
 * 日付範囲フィルタを、記録の日付と突き合わせられる境界に直す（Issue #47）。
 *
 * 「今月」「今年」は暦の区間なので月末・年末までを含む。対して「直近3ヶ月」は
 * 今日から遡る区間なので、上限は今日になる。先の日付を入れた記録は
 * 「今月」「今年」でなら出るが「直近3ヶ月」では出ない、という違いが出る。
 * どちらもラベルの読みどおりの動きなので、揃えずにこのままにしてある。
 */
export function resolveDateBounds(
  dateRange: DateRangeFilter,
  customFrom: string,
  customTo: string,
  now: Date,
): DateBounds {
  switch (dateRange) {
    case 'all':
      return {};
    case 'this-month':
      return {
        from: toDateString(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: toDateString(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      };
    case 'last-3-months':
      return { from: toDateString(shiftMonths(now, -3)), to: toDateString(now) };
    case 'this-year':
      return {
        from: toDateString(new Date(now.getFullYear(), 0, 1)),
        to: toDateString(new Date(now.getFullYear(), 11, 31)),
      };
    case 'custom':
      // 片側だけの指定も許す（「この日以降すべて」を出せるようにするため）
      return {
        from: isValidDateString(customFrom) ? customFrom : undefined,
        to: isValidDateString(customTo) ? customTo : undefined,
      };
    default:
      return {};
  }
}

/** 記録の日付が範囲に入っているか。範囲が空（すべて）なら常に true */
export function matchesDateRange(
  recordDate: string,
  filters: Pick<RecordFilters, 'dateRange' | 'customDateFrom' | 'customDateTo'>,
  now: Date,
): boolean {
  const { from, to } = resolveDateBounds(
    filters.dateRange,
    filters.customDateFrom,
    filters.customDateTo,
    now,
  );
  if (from !== undefined && recordDate < from) return false;
  if (to !== undefined && recordDate > to) return false;
  return true;
}
