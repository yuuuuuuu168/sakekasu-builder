import { Loader2, ScanLine } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import type { UnifiedRecord } from '@/features/records/types';
import { useSpecBackfill } from '../hooks/useSpecBackfill';
import type { SakeSpecs } from '../types';

interface SpecBackfillProps {
  /** フィルタ適用前の全記録（絞り込みに関係なく、残っている記録すべてを対象にする） */
  records: UnifiedRecord[];
  /** 読み取ったスペックを一覧へ反映する */
  onSpecsUpdated: (id: string, specs: SakeSpecs) => void;
}

/**
 * 詳細スペック（Issue #87）を持つより前に登録した記録へ、付いている写真から
 * 読み取ったスペックをまとめて書き込むための案内。
 *
 * **今できることが無ければ何も出さない。** 埋まった記録も、読んでも取れなかった
 * 記録も対象から外れるので、押しても何も起きない状態のバナーは画面に残らない。
 * 裏ラベルの写真を足せば対象に戻り、そのときまた出る
 */
export function SpecBackfill({ records, onSpecsUpdated }: SpecBackfillProps) {
  const { targets, skippedCount, run, isRunning, progress } = useSpecBackfill(
    records,
    onSpecsUpdated,
  );

  if (targets.length === 0 && !isRunning) return null;

  const handleClick = async () => {
    const result = await run();
    if (result.written === 0) {
      toast.error('写真から詳細スペックを読み取れる記録がありませんでした');
      return;
    }
    toast.success(
      result.skipped > 0
        ? `${result.written}件に書き込みました（${result.skipped}件は読み取れませんでした）`
        : `${result.written}件に書き込みました`,
    );
  };

  // 件数が実際の未入力数と食い違って見えるので、外している分は添えておく。
  // 押し直しても結果は変わらないため、ここから再挑戦はさせない
  const skippedNote =
    skippedCount > 0 ? (
      <span className="text-gray-500 dark:text-gray-500" data-testid="spec-backfill-skipped">
        {' '}
        （読み取れなかった {skippedCount}件を除く）
      </span>
    ) : null;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/20 bg-white/80 px-4 py-3 shadow-sm backdrop-blur-lg dark:bg-white/5"
      data-testid="spec-backfill"
    >
      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
        <ScanLine className="size-4 shrink-0 text-indigo-wa dark:text-dark-gold" />
        {isRunning ? (
          <span data-testid="spec-backfill-progress">
            写真から詳細スペックを読み取り中... {progress.done}/{progress.total}
          </span>
        ) : (
          <span>
            写真はあるが詳細スペックが空の記録が{' '}
            <span className="font-bold text-indigo-wa dark:text-dark-gold">{targets.length}</span>
            件あります
            {skippedNote}
          </span>
        )}
      </div>

      <Button
        type="button"
        size="sm"
        onClick={handleClick}
        disabled={isRunning}
        data-testid="spec-backfill-button"
      >
        {isRunning ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            読み取り中...
          </>
        ) : (
          '写真から読み取る'
        )}
      </Button>
    </div>
  );
}
