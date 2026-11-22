import { Star } from 'lucide-react';

/**
 * 評価の値を星1つと数字で出す（一覧や集計の中で使う小さな表示）。
 * 星は絵文字や記号の文字ではなく線のアイコンにそろえ、読み上げは aria-label で「評価 4」と読ませる
 */
export function RatingMark({ value, className = '' }: { value: number | string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 tabular-nums ${className}`}
      role="img"
      aria-label={`評価 ${value}`}
    >
      <Star className="size-3 shrink-0 fill-current text-gold-ink" strokeWidth={1.5} aria-hidden="true" />
      <span aria-hidden="true">{value}</span>
    </span>
  );
}
