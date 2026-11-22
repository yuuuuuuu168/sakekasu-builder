import { useMemo, useState } from 'react';
import type { ComponentProps } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale/ja';
import type { DayButton } from 'react-day-picker';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Calendar, CalendarDayButton } from '@/components/ui/calendar';
import { useRecordFetch } from '@/features/records/hooks/useRecordFetch';
import { LoadingState } from '@/features/records/components/LoadingState';
import { ErrorState } from '@/features/records/components/ErrorState';
import type { UnifiedRecord } from '@/features/records/types';
import { RatingMark } from '@/components/RatingMark';
import {
  collectMarkedDates,
  countMonthlyRecordDays,
  formatDateKey,
  groupRecordsByDate,
} from '../lib/aggregate';

/** 日セル：記録がある日の下にドットを表示する */
function RecordDayButton(props: ComponentProps<typeof DayButton>) {
  const { modifiers, children } = props;
  return (
    <CalendarDayButton {...props}>
      {children}
      {/* 記録がない日も高さを揃えるため常にドット行を描画する */}
      <span className="flex h-1 items-center gap-0.5" aria-hidden="true">
        {modifiers.purchased ? (
          <span className="size-1 rounded-full bg-gold-line in-data-[selected-single=true]:bg-primary-foreground" />
        ) : null}
        {modifiers.drank ? (
          <span className="size-1 rounded-full bg-indigo-wa in-data-[selected-single=true]:bg-primary-foreground dark:bg-ink-2" />
        ) : null}
      </span>
    </CalendarDayButton>
  );
}

/** 月間サマリーの1枠（飲んだ日数 / 買った日数） */
function MonthlySummaryTile({
  label,
  days,
  testId,
}: {
  label: string;
  days: number;
  testId: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className="mt-1 text-2xl font-bold text-foreground tabular-nums"
        data-testid={testId}
      >
        {days}
        <span className="ml-0.5 text-sm font-medium">日</span>
      </div>
    </div>
  );
}

/** 選択した日の記録1件分の行 */
function DayRecordItem({ record }: { record: UnifiedRecord }) {
  const isPurchase = record.type === 'purchase';
  const meta = isPurchase ? (
    record.price != null ? `¥${record.price.toLocaleString()}` : null
  ) : record.rating != null ? (
    <RatingMark value={record.rating} />
  ) : null;

  return (
    <li className="flex min-h-[44px] items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
      {/* 点の色はカレンダーの凡例とそろえる */}
      <span className="flex w-10 shrink-0 items-center gap-1.5 text-xs font-medium text-ink-2">
        <span
          className={`size-1.5 rounded-full ${isPurchase ? 'bg-gold-line' : 'bg-indigo-wa dark:bg-ink-2'}`}
          aria-hidden="true"
        />
        {isPurchase ? '購入' : '飲酒'}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {record.sakeName}
      </span>
      {meta && (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{meta}</span>
      )}
    </li>
  );
}

export function CalendarPage() {
  const { records, isLoading, error, refetch } = useRecordFetch();
  const [month, setMonth] = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date());

  const markedDates = useMemo(() => collectMarkedDates(records), [records]);
  const recordsByDate = useMemo(() => groupRecordsByDate(records), [records]);
  const monthlyDays = useMemo(() => countMonthlyRecordDays(records, month), [records, month]);

  const dayRecords = recordsByDate.get(formatDateKey(selected)) ?? [];
  const monthLabel = format(month, 'M月', { locale: ja });

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 pt-6 pb-24 sm:pt-10">
        {/* Header */}
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-primary sm:text-2xl">
            カレンダー
          </h1>
          <ThemeToggle />
        </header>

        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : (
          <div className="space-y-6">
            {/* 表示中の月のサマリー */}
            <div className="grid grid-cols-2 gap-3">
              <MonthlySummaryTile
                label={`${monthLabel}に飲んだ日`}
                days={monthlyDays.drinkingDays}
                testId="summary-drinking-days"
              />
              <MonthlySummaryTile
                label={`${monthLabel}に買った日`}
                days={monthlyDays.purchaseDays}
                testId="summary-purchase-days"
              />
            </div>

            {/* カレンダー本体 */}
            <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <Calendar
                mode="single"
                required
                selected={selected}
                onSelect={setSelected}
                month={month}
                onMonthChange={setMonth}
                locale={ja}
                modifiers={markedDates}
                components={{ DayButton: RecordDayButton }}
                classNames={{ root: 'w-full' }}
                className="bg-transparent p-0 [--cell-size:--spacing(11)]"
              />
              {/* 凡例 */}
              <div className="mt-3 flex justify-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-gold-line" />
                  買った日
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-indigo-wa dark:bg-ink-2" />
                  飲んだ日
                </span>
              </div>
            </section>

            {/* 選択した日の記録 */}
            <section>
              <h2 className="mb-3 text-sm font-bold text-foreground">
                {format(selected, 'M月d日（E）', { locale: ja })}の記録
              </h2>
              {dayRecords.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  この日の記録はありません
                </p>
              ) : (
                <ul className="space-y-2">
                  {dayRecords.map((record) => (
                    <DayRecordItem key={record.id} record={record} />
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
