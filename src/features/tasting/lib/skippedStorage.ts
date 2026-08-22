/**
 * 「ノートを書けなかった記録」を覚えておく置き場。
 *
 * 生成は temperature 0 で走るため、同じ銘柄名を投げれば答えも同じになる。
 * 覚えていないと、一括追記のバナーが同じ件数を出し続け、押すたびに同じ結果を
 * 繰り返す（実際に一度、64件を2周して1件も増えないまま Bedrock を128回呼んだ）。
 *
 * 書けなかった記録をここに控えて対象から外し、それでも試したいときのために
 * 「もう一度全部試す」で消せるようにする。
 */

/** 覚えておく件数の上限。壊れた値や肥大化した localStorage を掴まないため */
const MAX_SKIPPED_IDS = 1000;

/**
 * 記録と同じくユーザーごとに分けて保存する。
 * 同じ端末を別のアカウントで使ったときに、前の人の結果が残らないようにする
 */
function storageKey(userId: string): string {
  return `sakekasu:tasting-note-skipped:${userId}`;
}

/** 書けなかった記録のIDを読み出す。壊れていれば空で返す */
export function loadSkippedIds(userId: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string').slice(0, MAX_SKIPPED_IDS);
  } catch {
    return [];
  }
}

/** 書けなかった記録のIDを保存する（既存分と統合し、上限で頭を切る） */
export function saveSkippedIds(userId: string, ids: string[]): void {
  try {
    const merged = Array.from(new Set([...loadSkippedIds(userId), ...ids]));
    // 上限を超えたら古いものから捨てる。新しい結果のほうが今の実装に近い
    const trimmed = merged.slice(-MAX_SKIPPED_IDS);
    localStorage.setItem(storageKey(userId), JSON.stringify(trimmed));
  } catch {
    // 保存できなくても機能そのものは動く（次回また対象に出るだけ）
  }
}

/** 覚えている内容を消す。「もう一度全部試す」で使う */
export function clearSkippedIds(userId: string): void {
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    // 消せなくても実害は無い
  }
}
