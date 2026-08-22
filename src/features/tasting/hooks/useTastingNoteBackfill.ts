import { useCallback, useMemo, useState } from 'react';
import type { UnifiedRecord } from '@/features/records/types';
import { useAuth } from '@/features/auth/AuthContext';
import {
  clearSkippedIds,
  loadSkippedIds,
  saveSkippedIds,
} from '@/features/tasting/lib/skippedStorage';
import { selectTastingNoteTargets } from '@/features/tasting/lib/backfillTargets';
import { requestTastingNote } from '@/features/tasting/lib/requestTastingNote';
import { updateRecordMemo } from '@/features/tasting/lib/updateRecordMemo';
import {
  appendTastingNoteToMemo,
  supportsTastingNote,
  type NotableCategory,
} from '@/features/tasting/lib/tastingNoteMemo';

export interface BackfillProgress {
  /** 処理し終えた件数（書けたかどうかによらず進む） */
  done: number;
  /** 対象の総数 */
  total: number;
  /** 実際に備考へ書き足せた件数 */
  written: number;
  /** ノートを起こせなかった・保存できなかった件数 */
  skipped: number;
}

export interface UseTastingNoteBackfillReturn {
  /** まだノートの無いウイスキー・日本酒の購入記録（前回書けなかったものを除く） */
  targets: UnifiedRecord[];
  /** 前回書けずに対象から外している件数 */
  skippedCount: number;
  /** 一括追記を始める。終わったら結果を返す */
  run: () => Promise<BackfillProgress>;
  /** 書けなかった記録の記憶を消して、もう一度対象に戻す */
  retrySkipped: () => void;
  isRunning: boolean;
  progress: BackfillProgress;
}

const IDLE_PROGRESS: BackfillProgress = { done: 0, total: 0, written: 0, skipped: 0 };

/**
 * 機能追加より前に登録した記録へ、テイスティングノートをまとめて書き足す。
 *
 * 1件ずつ直列に処理する。まとめて投げると Bedrock を呼ぶ Lambda の予約枠
 * （api-stack.ts の TASTING_NOTE_RESERVED_CONCURRENCY）を一人で使い切り、
 * 同じ時間に登録している他の利用者のノートがスロットリングで落ちる。
 * 待ち時間より、落ちないことを採る。
 *
 * @param records 一覧が持っている全記録
 * @param onMemoUpdated 書き足せた記録を画面へ反映するためのコールバック
 */
export function useTastingNoteBackfill(
  records: UnifiedRecord[],
  onMemoUpdated: (id: string, memo: string) => void,
): UseTastingNoteBackfillReturn {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<BackfillProgress>(IDLE_PROGRESS);
  const { user } = useAuth();
  const userId = user?.userId ?? '';
  // 「書けなかった記録」を読み直す合図。実行のたびに増やす
  const [skippedRevision, setSkippedRevision] = useState(0);

  const skippedIds = useMemo(
    () => new Set(loadSkippedIds(userId)),
    // skippedRevision は localStorage を読み直すための依存
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, skippedRevision],
  );

  const eligible = useMemo(() => selectTastingNoteTargets(records), [records]);
  const targets = useMemo(
    () => eligible.filter((record) => !skippedIds.has(record.id)),
    [eligible, skippedIds],
  );
  const skippedCount = eligible.length - targets.length;

  const retrySkipped = useCallback(() => {
    clearSkippedIds(userId);
    setSkippedRevision((prev) => prev + 1);
  }, [userId]);

  const run = useCallback(async (): Promise<BackfillProgress> => {
    // 実行中に一覧が変わってもその回の対象は動かさない（同じ記録を二度処理しない）
    const skipped = new Set(loadSkippedIds(userId));
    const queue = selectTastingNoteTargets(records).filter(
      (record) => !skipped.has(record.id),
    );
    // 今回書けなかった記録。次回の対象から外すために控える
    const failedIds: string[] = [];
    const result: BackfillProgress = { done: 0, total: queue.length, written: 0, skipped: 0 };

    setIsRunning(true);
    setProgress({ ...result });

    try {
      for (const record of queue) {
        // selectTastingNoteTargets で絞ってあるが、型を狭めるために見る
        if (!supportsTastingNote(record.category)) {
          continue;
        }
        const category: NotableCategory = record.category;
        const note = await requestTastingNote(record.sakeName.trim(), category);
        if (note === null) {
          // 呼び出し自体の失敗。やり直せば結果が変わりうるので控えない
          result.skipped += 1;
          result.done += 1;
          setProgress({ ...result });
          continue;
        }
        const memo = appendTastingNoteToMemo(record.memo ?? '', note);

        // 知らない銘柄では memo が変わらない。無駄な更新は投げない
        if (memo !== (record.memo ?? '')) {
          const saved = await updateRecordMemo(record.id, memo);
          if (saved) {
            result.written += 1;
            onMemoUpdated(record.id, memo);
          } else {
            // 保存の失敗は一時的なものかもしれないので、対象から外さない
            result.skipped += 1;
          }
        } else {
          // ノートを起こせなかった記録。同じ銘柄名なら次も同じ結果になるので控える
          result.skipped += 1;
          failedIds.push(record.id);
        }

        result.done += 1;
        setProgress({ ...result });
      }
    } finally {
      if (failedIds.length > 0) {
        saveSkippedIds(userId, failedIds);
        setSkippedRevision((prev) => prev + 1);
      }
      setIsRunning(false);
    }

    return result;
  }, [records, onMemoUpdated, userId]);

  return { targets, skippedCount, run, retrySkipped, isRunning, progress };
}
