import { useCallback, useMemo, useState } from 'react';

import type { UnifiedRecord } from '@/features/records/types';
import { useAuth } from '@/features/auth/AuthContext';
import { createSkipStorage } from '@/lib/skipStorage';
import { selectSpecBackfillTargets, specSkipKey } from '../lib/backfillTargets';
import { requestLabelSpecs } from '../lib/requestLabelSpecs';
import { updateRecordSpecs } from '../lib/updateRecordSpecs';
import { pickSakeSpecs } from '../lib/sakeSpecs';
import type { SakeSpecs } from '../types';

/**
 * 控えの版。OCR の方式を変えたとき（モデルの差し替え、抽出項目やプロンプトの
 * 作り直しなど）に上げる。版が違う控えは読み捨てるので、以前は読めなかった
 * 記録が自動でもう一度対象に入る。
 *
 * 1: 詳細スペック12項目の抽出（Issue #88）
 */
const SKIP_VERSION = 1;

const skipStorage = createSkipStorage({
  namespace: 'spec-backfill-skipped',
  version: SKIP_VERSION,
});

export interface SpecBackfillProgress {
  /** 処理し終えた件数（読めたかどうかによらず進む） */
  done: number;
  /** 対象の総数 */
  total: number;
  /** 実際にスペックを書き込めた件数 */
  written: number;
  /** 読み取れなかった・保存できなかった件数 */
  skipped: number;
}

export interface UseSpecBackfillReturn {
  /** 写真があってスペックが空の記録（前回読めなかったものを除く） */
  targets: UnifiedRecord[];
  /** 前回読めずに対象から外している件数 */
  skippedCount: number;
  /** 一括読み取りを始める。終わったら結果を返す */
  run: () => Promise<SpecBackfillProgress>;
  isRunning: boolean;
  progress: SpecBackfillProgress;
}

const IDLE_PROGRESS: SpecBackfillProgress = { done: 0, total: 0, written: 0, skipped: 0 };

/**
 * 詳細スペックを持つより前に登録した記録へ、付いている写真から読み取った
 * スペックをまとめて書き込む。
 *
 * 一度読めなかった記録は控えて対象から外す。控えは記録IDと画像キーの組みなので、
 * あとから裏ラベルの写真を足せば自動でまた対象に入る。
 *
 * 1件ずつ直列に処理する。まとめて投げると OCR Lambda の予約枠
 * （api-stack.ts の OCR_RESERVED_CONCURRENCY）を一人で使い切り、
 * 同じ時間に登録している他の利用者の読み取りがスロットリングで落ちる。
 * 待ち時間より、落ちないことを採る。
 *
 * @param records 一覧が持っている全記録
 * @param onSpecsUpdated 書き込めた記録を画面へ反映するためのコールバック
 */
export function useSpecBackfill(
  records: UnifiedRecord[],
  onSpecsUpdated: (id: string, specs: SakeSpecs) => void,
): UseSpecBackfillReturn {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<SpecBackfillProgress>(IDLE_PROGRESS);
  const { user } = useAuth();
  const userId = user?.userId ?? '';
  // 「読めなかった記録」を読み直す合図。実行のたびに増やす
  const [skippedRevision, setSkippedRevision] = useState(0);

  const skippedKeys = useMemo(
    () => new Set(skipStorage.load(userId)),
    // skippedRevision は localStorage を読み直すための依存
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, skippedRevision],
  );

  const eligible = useMemo(() => selectSpecBackfillTargets(records), [records]);
  const targets = useMemo(
    () => eligible.filter((record) => !skippedKeys.has(specSkipKey(record))),
    [eligible, skippedKeys],
  );
  const skippedCount = eligible.length - targets.length;

  const run = useCallback(async (): Promise<SpecBackfillProgress> => {
    // 実行中に一覧が変わってもその回の対象は動かさない（同じ記録を二度処理しない）
    const skipped = new Set(skipStorage.load(userId));
    const queue = selectSpecBackfillTargets(records).filter(
      (record) => !skipped.has(specSkipKey(record)),
    );
    // 今回読めなかった記録。次回の対象から外すために控える
    const failedKeys: string[] = [];
    const result: SpecBackfillProgress = {
      done: 0,
      total: queue.length,
      written: 0,
      skipped: 0,
    };

    setIsRunning(true);
    setProgress({ ...result });

    try {
      for (const record of queue) {
        const specs = await requestLabelSpecs(record.imageKeys);

        if (specs === null) {
          // 呼び出し自体の失敗。やり直せば結果が変わりうるので控えない
          result.skipped += 1;
          result.done += 1;
          setProgress({ ...result });
          continue;
        }

        if (Object.keys(specs).length === 0) {
          // 写真から何も読めなかった記録。同じ写真なら次も同じ結果になるので控える
          result.skipped += 1;
          failedKeys.push(specSkipKey(record));
          result.done += 1;
          setProgress({ ...result });
          continue;
        }

        const saved = await updateRecordSpecs(record.id, record.type, specs);
        if (saved) {
          result.written += 1;
          // 一覧へ返すのは全項目そろった形。読み取れた項目だけを既存の値に重ねる
          onSpecsUpdated(record.id, { ...pickSakeSpecs(record.specs ?? {}), ...specs });
        } else {
          // 保存の失敗は一時的なものかもしれないので、対象から外さない
          result.skipped += 1;
        }

        result.done += 1;
        setProgress({ ...result });
      }
    } finally {
      if (failedKeys.length > 0) {
        skipStorage.save(userId, failedKeys);
        setSkippedRevision((prev) => prev + 1);
      }
      setIsRunning(false);
    }

    return result;
  }, [records, onSpecsUpdated, userId]);

  return { targets, skippedCount, run, isRunning, progress };
}
