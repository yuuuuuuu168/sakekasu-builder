/**
 * 一括処理で「やっても結果が変わらなかった記録」を覚えておく置き場。
 *
 * テイスティングノートの一括追記と、写真からの詳細スペック一括読み取りが使う。
 * どちらも temperature 0 で走るので、同じ入力を投げれば答えも同じになる。
 * 覚えていないとバナーが同じ件数を出し続け、押すたびに同じ結果を繰り返す
 * （実際に一度、64件を2周して1件も増えないまま Bedrock を128回呼んだ）。
 *
 * 控える鍵は呼び出し側が決める。記録IDだけで覚えると入力を直しても対象に
 * 戻らないので、入力（銘柄名・画像キーなど）を鍵に混ぜて、直せば別の鍵に
 * なるようにする
 */

/** 覚えておく件数の上限。壊れた値や肥大化した localStorage を掴まないため */
const MAX_SKIPPED_KEYS = 1000;

interface StoredSkips {
  version: number;
  keys: string[];
}

export interface SkipStorage {
  /** 控えた鍵を読み出す。壊れていれば・版が違えば空で返す */
  load: (userId: string) => string[];
  /** 鍵を控える（既存分と統合し、上限で頭を切る） */
  save: (userId: string, keys: string[]) => void;
}

export interface SkipStorageOptions {
  /** localStorage のキーに使う名前。処理ごとに分ける */
  namespace: string;
  /**
   * 控えの版。判定の方式を変えたとき（モデルの差し替え、プロンプトの作り直しなど）
   * に上げる。版が違う控えは読み捨てるので、以前は駄目だった記録が自動で
   * もう一度対象に入る
   */
  version: number;
}

export function createSkipStorage({ namespace, version }: SkipStorageOptions): SkipStorage {
  /**
   * 記録と同じくユーザーごとに分けて保存する。
   * 同じ端末を別のアカウントで使ったときに、前の人の結果が残らないようにする
   */
  const storageKey = (userId: string) => `sakekasu:${namespace}:${userId}`;

  const load = (userId: string): string[] => {
    try {
      const raw = localStorage.getItem(storageKey(userId));
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return [];
      }
      const stored = parsed as Partial<StoredSkips>;
      if (stored.version !== version || !Array.isArray(stored.keys)) {
        return [];
      }
      return stored.keys
        .filter((key): key is string => typeof key === 'string')
        .slice(0, MAX_SKIPPED_KEYS);
    } catch {
      return [];
    }
  };

  const save = (userId: string, keys: string[]): void => {
    try {
      const merged = Array.from(new Set([...load(userId), ...keys]));
      // 上限を超えたら古いものから捨てる。新しい結果のほうが今の実装に近い
      const stored: StoredSkips = {
        version,
        keys: merged.slice(-MAX_SKIPPED_KEYS),
      };
      localStorage.setItem(storageKey(userId), JSON.stringify(stored));
    } catch {
      // 保存できなくても機能そのものは動く（次回また対象に出るだけ）
    }
  };

  return { load, save };
}
