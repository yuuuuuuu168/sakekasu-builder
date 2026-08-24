/**
 * 「ノートを書けなかった記録」を覚えておく置き場。
 *
 * 覚えていないと、一括追記のバナーが同じ件数を出し続け、押すたびに同じ結果を
 * 繰り返す。仕組みそのものは詳細スペックの一括読み取りと共通で、
 * [src/lib/skipStorage.ts](../../../lib/skipStorage.ts) にある。
 *
 * 控えるのは記録IDと銘柄名の組み。IDだけで覚えると、銘柄名を直しても
 * 対象に戻らず、OCR の読み取りミスを直す道が無くなる。名前を変えれば
 * 別の鍵になり、次の一括追記でもう一度試される。
 */

import { createSkipStorage } from '@/lib/skipStorage';

/**
 * 控えの版。生成の方式を変えたとき（モデルの差し替え、検索の追加、プロンプトの
 * 作り直しなど）に上げる。
 *
 * 1: 学習知識のみ / 2: Web 検索のフォールバックを追加
 */
const SKIP_VERSION = 2;

const storage = createSkipStorage({
  namespace: 'tasting-note-skipped',
  version: SKIP_VERSION,
});

/** 控えの鍵。銘柄名を変えれば別の鍵になり、もう一度対象に入る */
export function skipKey(id: string, sakeName: string): string {
  return `${id}:${sakeName.trim()}`;
}

/** 書けなかった記録の鍵を読み出す。壊れていれば・版が違えば空で返す */
export function loadSkippedKeys(userId: string): string[] {
  return storage.load(userId);
}

/** 書けなかった記録の鍵を保存する（既存分と統合し、上限で頭を切る） */
export function saveSkippedKeys(userId: string, keys: string[]): void {
  storage.save(userId, keys);
}
