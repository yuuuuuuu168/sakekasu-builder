import { useCallback, useMemo, useState } from 'react';

import type { UnifiedRecord } from '@/features/records/types';
import { useAuth } from '@/features/auth/AuthContext';
import { createSkipStorage } from '@/lib/skipStorage';
import {
  selectSpecBackfillTargets,
  selectSpecRereadTargets,
  specSkipKey,
} from '../lib/backfillTargets';
import { requestLabelSpecs } from '../lib/requestLabelSpecs';
import { updateRecordSpecs } from '../lib/updateRecordSpecs';
import { pickSakeSpecs } from '../lib/sakeSpecs';
import type { SakeSpecs } from '../types';

/**
 * 読み取りの方式の版。OCR を変えたとき（モデルの差し替え、抽出項目やプロンプトの
 * 作り直しなど）に上げる。
 *
 * 版が違う控えは読み捨てるので、以前は読めなかった記録が自動でもう一度対象に入る。
 * 「読み直す」の案内も版ごとに1度だけ出す。
 *
 * 1: 詳細スペック12項目の抽出（Issue #88）
 * 2: ラベルの転記テキストとの照合を追加（読めないと一般的な値を埋めていたため）
 */
const EXTRACTION_VERSION = 2;

const skipStorage = createSkipStorage({
  namespace: 'spec-backfill-skipped',
  version: EXTRACTION_VERSION,
});

/**
 * 「この版で読み直しを済ませたか」の控え。
 *
 * 読み直しは、読み取りの精度を上げたあとに以前の結果を正すためのもの。
 * 一度やれば用は済むので、案内は版ごとに1度だけ出す。次に OCR を変えて
 * 版を上げたら、また出る
 */
const rereadStorage = createSkipStorage({
  namespace: 'spec-reread-done',
  version: EXTRACTION_VERSION,
});

/**
 * 画像そのものが原因で読めない記録の控え。`skipStorage` とは別に持つ。
 *
 * `skipStorage` は EXTRACTION_VERSION で版を切っている。読み取りの方式を変えれば
 * 結果が変わりうるからで、版を上げれば控えは読み捨てられて対象に戻る。
 *
 * こちらは戻してはいけない。5MB を超えた画像や、中身が画像でないファイルは、
 * モデルを替えてもプロンプトを直しても大きさや中身が変わるわけではない。
 * 版に紐づけると、版を上げるたびに同じ失敗を一斉に繰り返す。
 *
 * 版を切らない理由は実例がある。2026-08-24 の一括読み取りは 150 回中 78 回が
 * `Image too large for OCR` で落ちた。詳細スペックを持つより前に登録した写真は
 * フロントの圧縮（Issue #115 の修正、PR #117）を通っていないため、
 * ほぼ確実にこの上限を越える。控えずに放っておくと、押すたびに同じ 78 件を
 * 投げ直し、OCR の30日 SLO を 54% まで落とす。
 *
 * 鍵は記録IDと画像キーの組みなので、写真を撮り直して差し替えれば別の鍵になり、
 * 自動でまた対象に入る。読み直し（reread）でもこの控えは尊重する。
 * 読み直しは読み取りの精度を上げたあとに試し直すための口だが、
 * 精度をいくら上げても画像の大きさは変わらない
 */
const unreadableStorage = createSkipStorage({
  namespace: 'spec-unreadable-image',
  // 画像が変わらない限り結果も変わらないので、版で読み捨てない
  version: 1,
});

/** 控えの中身は問わない。この版で済ませたかどうかだけを見る */
const REREAD_DONE = 'done';

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
  /**
   * 写真がある記録すべて。読み直し（丸ごと入れ替え）の対象。
   * 「読めなかった」控えは見ない。読み取りの精度を上げたあとに、
   * もう一度試すための口なので。
   *
   * ただし画像そのものが読めない記録（大きすぎる・画像でない）は外す。
   * 精度を上げても結果が変わらないため。
   *
   * この版で読み直しを済ませていれば空になる（案内を出し続けないため）
   */
  rereadTargets: UnifiedRecord[];
  /** 前回読めずに対象から外している件数 */
  skippedCount: number;
  /**
   * 一括読み取りを始める。終わったら結果を返す。
   *
   * reread を渡すと、すでにスペックが入っている記録も対象にして丸ごと
   * 入れ替える（読み取れなかった項目は空に戻る）
   */
  run: (options?: { reread?: boolean }) => Promise<SpecBackfillProgress>;
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

  const unreadableKeys = useMemo(
    () => new Set(unreadableStorage.load(userId)),
    // skippedRevision は localStorage を読み直すための依存
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, skippedRevision],
  );

  const eligible = useMemo(() => selectSpecBackfillTargets(records), [records]);
  const targets = useMemo(
    () =>
      eligible.filter((record) => {
        const key = specSkipKey(record);
        return !skippedKeys.has(key) && !unreadableKeys.has(key);
      }),
    [eligible, skippedKeys, unreadableKeys],
  );
  const skippedCount = eligible.length - targets.length;
  // 済ませた版では案内を出さない。skippedRevision は実行後に読み直すための依存
  const rereadTargets = useMemo(
    () =>
      rereadStorage.load(userId).includes(REREAD_DONE)
        ? []
        : // 読めない画像は読み直しからも外す（精度を上げても大きさは変わらない）
          selectSpecRereadTargets(records).filter(
            (record) => !unreadableKeys.has(specSkipKey(record)),
          ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, userId, skippedRevision, unreadableKeys],
  );

  const run = useCallback(
    async ({ reread = false }: { reread?: boolean } = {}): Promise<SpecBackfillProgress> => {
    // 実行中に一覧が変わってもその回の対象は動かさない（同じ記録を二度処理しない）
    const skipped = new Set(skipStorage.load(userId));
    // 画像そのものが読めない記録は、読み直しでも外す。精度を上げても
    // 5MB の上限は変わらないので、投げれば必ず同じ失敗になる
    const unreadable = new Set(unreadableStorage.load(userId));
    // 読み直しでは控えも無視する。精度を上げたあとに試し直すための口なので、
    // 前回読めなかった記録こそもう一度当てたい
    const queue = (
      reread
        ? selectSpecRereadTargets(records)
        : selectSpecBackfillTargets(records).filter(
            (record) => !skipped.has(specSkipKey(record)),
          )
    ).filter((record) => !unreadable.has(specSkipKey(record)));
    // 今回読めなかった記録。次回の対象から外すために控える
    const failedKeys: string[] = [];
    // 画像を差し替えない限り読めない記録。版を跨いで対象から外すために控える
    const unreadableFound: string[] = [];
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
        const outcome = await requestLabelSpecs(record.imageKeys);

        if (outcome.status === 'retryable') {
          // 呼び出し自体の失敗。やり直せば結果が変わりうるので控えない
          result.skipped += 1;
          result.done += 1;
          setProgress({ ...result });
          continue;
        }

        if (outcome.status === 'permanent') {
          // 画像そのものが原因。差し替えない限り何度投げても同じなので、
          // 版を跨いで対象から外す
          result.skipped += 1;
          unreadableFound.push(specSkipKey(record));
          result.done += 1;
          setProgress({ ...result });
          continue;
        }

        const { specs } = outcome;

        if (Object.keys(specs).length === 0 && !reread) {
          // 写真から何も読めなかった記録。同じ写真なら次も同じ結果になるので控える
          result.skipped += 1;
          failedKeys.push(specSkipKey(record));
          result.done += 1;
          setProgress({ ...result });
          continue;
        }

        // 読み直しでは、何も読めなくても空で入れ替える。
        // 以前に書き込まれた誤った値を残さないため
        const saved = await updateRecordSpecs(record.id, record.type, specs, {
          replace: reread,
        });
        if (saved) {
          result.written += 1;
          // 一覧へ返すのは全項目そろった形。
          // 読み直しでは入れ替えなので、既存の値には重ねない
          onSpecsUpdated(
            record.id,
            reread ? pickSakeSpecs(specs) : { ...pickSakeSpecs(record.specs ?? {}), ...specs },
          );
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
      }
      if (unreadableFound.length > 0) {
        unreadableStorage.save(userId, unreadableFound);
      }
      if (reread) {
        // この版での読み直しは済んだ。次に版を上げるまで案内を出さない
        rereadStorage.save(userId, [REREAD_DONE]);
      }
      if (failedKeys.length > 0 || unreadableFound.length > 0 || reread) {
        setSkippedRevision((prev) => prev + 1);
      }
      setIsRunning(false);
    }

    return result;
    },
    [records, onSpecsUpdated, userId],
  );

  return { targets, rereadTargets, skippedCount, run, isRunning, progress };
}
