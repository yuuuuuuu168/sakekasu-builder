import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import type { UnifiedRecord } from '@/features/records/types';
import { useTastingNoteBackfill } from '@/features/tasting/hooks/useTastingNoteBackfill';

interface TastingNoteBackfillProps {
  /** フィルタ適用前の全記録（絞り込みに関係なく、残っている記録すべてを対象にする） */
  records: UnifiedRecord[];
  /** 追記した備考を一覧へ反映する */
  onMemoUpdated: (id: string, memo: string) => void;
}

/**
 * 機能追加より前に登録したウイスキー・日本酒へ、テイスティングノートを
 * まとめて書き足すための案内。
 *
 * 対象が無ければ何も出さない。一度追記すればその記録は対象から外れるので、
 * 全部書き終われば自然に消える
 */
export function TastingNoteBackfill({ records, onMemoUpdated }: TastingNoteBackfillProps) {
  const { targets, run, isRunning, progress } = useTastingNoteBackfill(records, onMemoUpdated);

  if (targets.length === 0 && !isRunning) return null;

  const handleClick = async () => {
    const result = await run();
    if (result.written === 0) {
      toast.error('テイスティングノートを書ける記録がありませんでした');
      return;
    }
    toast.success(
      result.skipped > 0
        ? `${result.written}件に追記しました（${result.skipped}件は書けませんでした）`
        : `${result.written}件に追記しました`,
    );
  };

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/20 bg-white/80 px-4 py-3 shadow-sm backdrop-blur-lg dark:bg-white/5"
      data-testid="tasting-note-backfill"
    >
      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
        <Sparkles className="size-4 shrink-0 text-indigo-wa dark:text-dark-gold" />
        {isRunning ? (
          <span data-testid="tasting-note-backfill-progress">
            テイスティングノートを追記中... {progress.done}/{progress.total}
          </span>
        ) : (
          <span>
            テイスティングノート未記載のウイスキー・日本酒が{' '}
            <span className="font-bold text-indigo-wa dark:text-dark-gold">{targets.length}</span>
            件あります
          </span>
        )}
      </div>

      <Button
        type="button"
        size="sm"
        onClick={handleClick}
        disabled={isRunning}
        data-testid="tasting-note-backfill-button"
      >
        {isRunning ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            追記中...
          </>
        ) : (
          '一括で追記する'
        )}
      </Button>
    </div>
  );
}
