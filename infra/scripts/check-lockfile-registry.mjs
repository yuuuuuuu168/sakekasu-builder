#!/usr/bin/env node
/**
 * package-lock.json の取得元が npm レジストリだけかを確かめる。
 *
 * cdk-diff.yml は PR のブランチを checkout し、認証情報を入れたあとに
 * `npx cdkd diff` を走らせる。`npm ci --ignore-scripts` が止めるのは npm の
 * インストール時スクリプトだけで、`cdkd` 自体のコードは意図して実行される。
 * lockfile は PR が書き換えられるので、`resolved` を自前のターゲットへ向けて
 * 整合性ハッシュをそれに合わせれば、認証後に動く CLI が PR のコードになる
 * （PR #230 で aws-security-agent が指摘、MEDIUM）。
 *
 * これはその経路を塞ぐための検査で、認証情報を入れる前に走らせる。
 * 版を上げる PR は `resolved` がレジストリのまま変わるだけなので止まらない。
 *
 * 塞げないものも書いておく。
 *
 * - npm に公開された不正なパッケージ（typosquat や乗っ取られた版）は通る。
 *   取得元はレジストリのままなので、この検査の範囲外
 * - `pull_request` ではワークフローの定義自体が PR のブランチから読まれるため、
 *   PR でこのステップごと消せる。消したことが差分に出る、という程度の担保
 *
 * 根本的な対処は #131 に記録してある。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 許可する取得元 */
export const ALLOWED_HOSTS = ['registry.npmjs.org'];

/**
 * 許可していない取得元を指しているパッケージを集める。
 *
 * `resolved` を持たないものは対象外。親の tarball に同梱される依存で、
 * 個別に取りに行かない。
 *
 * @param {{ packages?: Record<string, { resolved?: string, link?: boolean }> }} lock
 * @returns {{ name: string, resolved: string }[]}
 */
export function findForeignResolved(lock) {
  return Object.entries(lock.packages ?? {})
    .filter(([name]) => name !== '')
    .flatMap(([name, pkg]) => {
      const resolved = pkg?.resolved;
      if (typeof resolved !== 'string' || resolved === '') return [];

      let host;
      try {
        host = new URL(resolved).host;
      } catch {
        // URL として読めないものは、そもそも素性が分からないので弾く
        return [{ name, resolved }];
      }

      return ALLOWED_HOSTS.includes(host) ? [] : [{ name, resolved }];
    });
}

/** @param {string} lockPath */
export function checkLockfile(lockPath) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  return findForeignResolved(lock);
}

// 直に実行されたときだけ検査して終了コードを返す
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const lockPath = process.argv[2] ?? join(process.cwd(), 'package-lock.json');
  const offenders = checkLockfile(lockPath);

  if (offenders.length > 0) {
    console.error(
      `::error::${lockPath} が npm レジストリ以外から依存を取ろうとしています。` +
        ' 認証情報を入れたあとに動く CLI を差し替えられる経路になります。',
    );
    for (const { name, resolved } of offenders) console.error(`  ${name} → ${resolved}`);
    process.exit(1);
  }

  console.log(`取得元はすべて ${ALLOWED_HOSTS.join(' / ')} でした。`);
}
