/** {@link ./check-lockfile-registry.mjs} の型 */

/** 許可していない取得元を指しているパッケージ */
export interface ForeignResolved {
  name: string;
  resolved: string;
}

/** lockfile 1本あたりの検査結果 */
export interface LockfileResult {
  lockPath: string;
  offenders: ForeignResolved[];
  /** 取得元を確かめられない形だった場合の理由 */
  problems: string[];
}

/**
 * 検査に渡す lockfile の形。
 *
 * 見るのは packages / dependencies / lockfileVersion だけだが、実物には
 * name や requires などが並ぶので、余分なキーを受けられる形にしてある
 */
export interface Lockfile {
  lockfileVersion?: unknown;
  packages?: Record<string, unknown>;
  dependencies?: unknown;
  [key: string]: unknown;
}

export declare const ALLOWED_HOSTS: string[];
export declare const MIN_LOCKFILE_VERSION: number;

export declare function discoverLockfiles(root?: string): string[];

export declare function findForeignResolved(lock: Lockfile): ForeignResolved[];

export declare function findShapeProblems(lock: Lockfile): string[];

export declare function checkLockfiles(lockPaths: string[]): LockfileResult[];
