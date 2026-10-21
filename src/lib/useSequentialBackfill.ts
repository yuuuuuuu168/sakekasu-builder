import { useCallback, useState } from 'react';

/**
 * 一括処理の進み具合。
 *
 * テイスティングノートの一括追記と、写真からの詳細スペック一括読み取りが使う。
 * 「書けた」「書けなかった」が何を指すかは呼び出し側の処理で決まる
 */
export interface BackfillProgress {
  /** 処理し終えた件数（書けたかどうかによらず進む） */
  done: number;
  /** 対象の総数 */
  total: number;
  /** 実際に書き込めた件数 */
  written: number;
  /** 書けなかった・保存できなかった件数 */
  skipped: number;
}

/**
 * 1件分の処理の結果。
 *
 * - `written`: 書き込めた
 * - `skipped`: 書けなかった・保存できなかった
 * - `ignored`: 処理しなかった。件数にも進み具合にも数えない
 */
export type BackfillItemOutcome = 'written' | 'skipped' | 'ignored';

export interface UseSequentialBackfillReturn {
  isRunning: boolean;
  progress: BackfillProgress;
  /**
   * localStorage の控えを読み直す合図。控えを書き換えた回の終わりに増える。
   * 呼び出し側は控えを読む useMemo の依存に入れる
   */
  skippedRevision: number;
  /**
   * 対象を1件ずつ直列に処理する。終わったら結果を返す。
   *
   * saveSkips は途中で例外が出ても最後に必ず呼ぶ。今回の結果を控えに書き出し、
   * 控えを書き換えたら true を返す（skippedRevision が進む）
   */
  runQueue: <T>(
    queue: readonly T[],
    processItem: (item: T) => Promise<BackfillItemOutcome>,
    saveSkips: () => boolean,
  ) => Promise<BackfillProgress>;
}

const IDLE_PROGRESS: BackfillProgress = { done: 0, total: 0, written: 0, skipped: 0 };

/**
 * 記録を1件ずつ外部の処理（OCR・Bedrock）へ投げる一括処理の、進み具合と
 * 実行中フラグの持ち方をまとめたもの。
 *
 * 直列にするのは、まとめて投げると Lambda の予約枠を一人で使い切り、
 * 同じ時間に使っている他の利用者の呼び出しがスロットリングで落ちるため。
 * 何を対象にして、1件をどう処理し、何を控えるかは呼び出し側が決める
 */
export function useSequentialBackfill(): UseSequentialBackfillReturn {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<BackfillProgress>(IDLE_PROGRESS);
  const [skippedRevision, setSkippedRevision] = useState(0);

  const runQueue = useCallback(
    async <T>(
      queue: readonly T[],
      processItem: (item: T) => Promise<BackfillItemOutcome>,
      saveSkips: () => boolean,
    ): Promise<BackfillProgress> => {
      const result: BackfillProgress = { done: 0, total: queue.length, written: 0, skipped: 0 };

      setIsRunning(true);
      setProgress({ ...result });

      try {
        for (const item of queue) {
          const outcome = await processItem(item);
          if (outcome === 'ignored') {
            continue;
          }
          result[outcome] += 1;
          result.done += 1;
          setProgress({ ...result });
        }
      } finally {
        if (saveSkips()) {
          setSkippedRevision((prev) => prev + 1);
        }
        setIsRunning(false);
      }

      return result;
    },
    [],
  );

  return { isRunning, progress, skippedRevision, runQueue };
}
