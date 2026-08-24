import { useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
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
 * 裏ラベルの写真を足せば対象に戻り、そのときまた出る。
 *
 * 読み直し（すでに入っているスペックごと入れ替える）は別の導線にしてある。
 * 押し間違えると手で入れた値まで消えるので、確認を挟む
 */
export function SpecBackfill({ records, onSpecsUpdated }: SpecBackfillProps) {
  const { targets, rereadTargets, skippedCount, run, isRunning, progress } = useSpecBackfill(
    records,
    onSpecsUpdated,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (targets.length === 0 && rereadTargets.length === 0 && !isRunning) return null;

  const notifyResult = (written: number, skipped: number) => {
    if (written === 0) {
      toast.error('写真から詳細スペックを読み取れる記録がありませんでした');
      return;
    }
    toast.success(
      skipped > 0
        ? `${written}件に書き込みました（${skipped}件は読み取れませんでした）`
        : `${written}件に書き込みました`,
    );
  };

  const handleClick = async () => {
    const result = await run();
    notifyResult(result.written, result.skipped);
  };

  const handleReread = async () => {
    setConfirmOpen(false);
    const result = await run({ reread: true });
    notifyResult(result.written, result.skipped);
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
        ) : targets.length > 0 ? (
          <span>
            写真はあるが詳細スペックが空の記録が{' '}
            <span className="font-bold text-indigo-wa dark:text-dark-gold">{targets.length}</span>
            件あります
            {skippedNote}
          </span>
        ) : (
          <span>
            写真のある記録は{' '}
            <span className="font-bold text-indigo-wa dark:text-dark-gold">
              {rereadTargets.length}
            </span>
            件。読み取り結果が怪しければ読み直せます
            {skippedNote}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {rereadTargets.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setConfirmOpen(true)}
            disabled={isRunning}
            data-testid="spec-backfill-reread-button"
          >
            すべて読み直す
          </Button>
        )}

        {targets.length > 0 && (
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
        )}
      </div>

      <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
          <Dialog.Popup
            className="fixed top-1/2 left-1/2 z-50 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-card p-6 shadow-xl ring-1 ring-border data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
            data-testid="spec-backfill-confirm"
          >
            <Dialog.Title className="text-lg font-semibold text-card-foreground">
              詳細スペックを読み直す
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted-foreground">
              写真のある {rereadTargets.length}件を読み直して、詳細スペックを丸ごと入れ替えます。
              読み取れなかった項目は空になるため、手で入力した値も消えます。
            </Dialog.Description>
            <div className="mt-6 flex justify-end gap-3">
              <Dialog.Close render={<Button variant="outline">キャンセル</Button>} />
              <Button type="button" onClick={handleReread} data-testid="spec-backfill-reread-confirm">
                読み直す
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
