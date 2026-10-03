/** {@link ./check-lockfile-registry.mjs} の型 */

/**
 * package-lock.json の packages の1項目。
 *
 * 見るのは resolved だけだが、実物には version / integrity / dependencies など
 * が並ぶので、余分なキーを受けられる形にしてある
 */
export interface LockPackage {
  resolved?: string;
  link?: boolean;
  [key: string]: unknown;
}

export interface Lockfile {
  packages?: Record<string, LockPackage | undefined>;
}

/** 許可していない取得元を指しているパッケージ */
export interface ForeignResolved {
  name: string;
  resolved: string;
}

export declare const ALLOWED_HOSTS: string[];

export declare function findForeignResolved(lock: Lockfile): ForeignResolved[];

export declare function checkLockfile(lockPath: string): ForeignResolved[];
