/**
 * 「ノートを書けなかった記録」を覚えておく置き場。
 *
 * 生成は temperature 0 で走るため、同じ銘柄名を投げれば答えも同じになる。
 * 覚えていないと、一括追記のバナーが同じ件数を出し続け、押すたびに同じ結果を
 * 繰り返す（実際に一度、64件を2周して1件も増えないまま Bedrock を128回呼んだ）。
 *
 * 控えるのは記録IDと銘柄名の組み。IDだけで覚えると、銘柄名を直しても
 * 対象に戻らず、OCR の読み取りミスを直す道が無くなる。名前を変えれば
 * 別の鍵になり、次の一括追記でもう一度試される。
 */

/**
 * 控えの版。生成の方式を変えたとき（モデルの差し替え、検索の追加、プロンプトの
 * 作り直しなど）に上げる。版が違う控えは読み捨てるので、以前は書けなかった
 * 記録が自動でもう一度対象に入る。
 *
 * 1: 学習知識のみ / 2: Web 検索のフォールバックを追加
 */
const SKIP_VERSION = 2;

/** 覚えておく件数の上限。壊れた値や肥大化した localStorage を掴まないため */
const MAX_SKIPPED_KEYS = 1000;

interface StoredSkips {
  version: number;
  keys: string[];
}

/**
 * 記録と同じくユーザーごとに分けて保存する。
 * 同じ端末を別のアカウントで使ったときに、前の人の結果が残らないようにする
 */
function storageKey(userId: string): string {
  return `sakekasu:tasting-note-skipped:${userId}`;
}

/** 控えの鍵。銘柄名を変えれば別の鍵になり、もう一度対象に入る */
export function skipKey(id: string, sakeName: string): string {
  return `${id}:${sakeName.trim()}`;
}

/** 書けなかった記録の鍵を読み出す。壊れていれば・版が違えば空で返す */
export function loadSkippedKeys(userId: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return [];
    }
    const stored = parsed as Partial<StoredSkips>;
    if (stored.version !== SKIP_VERSION || !Array.isArray(stored.keys)) {
      return [];
    }
    return stored.keys
      .filter((key): key is string => typeof key === 'string')
      .slice(0, MAX_SKIPPED_KEYS);
  } catch {
    return [];
  }
}

/** 書けなかった記録の鍵を保存する（既存分と統合し、上限で頭を切る） */
export function saveSkippedKeys(userId: string, keys: string[]): void {
  try {
    const merged = Array.from(new Set([...loadSkippedKeys(userId), ...keys]));
    // 上限を超えたら古いものから捨てる。新しい結果のほうが今の実装に近い
    const stored: StoredSkips = {
      version: SKIP_VERSION,
      keys: merged.slice(-MAX_SKIPPED_KEYS),
    };
    localStorage.setItem(storageKey(userId), JSON.stringify(stored));
  } catch {
    // 保存できなくても機能そのものは動く（次回また対象に出るだけ）
  }
}
