#!/usr/bin/env node
/**
 * lockfile の取得元が npm レジストリだけかを確かめる。
 *
 * ワークフローは AWS の認証情報を入れる前に依存を取り、テストを走らせ、合成する。
 * `npm ci --ignore-scripts` が止めるのは npm のインストール時スクリプトだけで、
 * モジュール読み込み時のコードや、意図して実行する CLI 本体には効かない。
 * lockfile は PR が書き換えられるので、`resolved` を自前のターゲットへ向けて
 * 整合性ハッシュをそれに合わせれば、そこが任意コードの実行点になる
 * （PR #230 で aws-security-agent が指摘）。
 *
 * **「認証情報より前だから安全」ではない。** ジョブには `id-token: write` が
 * あるので、動いたコードは自分で OIDC トークンを取ってデプロイロールに入れる。
 * 認証ステップより前かどうかは関係がない。だからこの検査は取得そのものより
 * 前に置く。
 *
 * 見るのは、認証情報の有無にかかわらずワークフローが取得・import する全部。
 * infra 本体と lambda ごとの lockfile。vitest.config の include が lambda 配下の
 * __tests__ を拾うため、`npm test` でそれらのモジュールと依存が読み込まれる。
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

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 許可する取得元 */
export const ALLOWED_HOSTS = ['registry.npmjs.org'];

/**
 * 検査する lockfile を集める。
 *
 * `infra/` で実行することを前提に、本体と lambda ごとのものを返す。
 *
 * @param {string} [root] infra のパス（既定はカレント）
 * @returns {string[]}
 */
export function discoverLockfiles(root = process.cwd()) {
  const found = [];

  const top = join(root, 'package-lock.json');
  if (existsSync(top)) found.push(top);

  const lambdaDir = join(root, 'lambda');
  if (existsSync(lambdaDir)) {
    for (const entry of readdirSync(lambdaDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const lock = join(lambdaDir, entry.name, 'package-lock.json');
      if (existsSync(lock)) found.push(lock);
    }
  }

  return found;
}

/**
 * 許可していない取得元を指しているパッケージを集める。
 *
 * `resolved` を持たないものは対象外。親の tarball に同梱される依存で、
 * 個別に取りに行かない。
 *
 * @param {{ packages?: Record<string, { resolved?: string, link?: boolean } | undefined> }} lock
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

/**
 * lockfile 群を検査する。
 *
 * 1本も見つからないのは異常として扱う。黙って何も検査しない状態が
 * 「緑」になるのを避ける。
 *
 * @param {string[]} lockPaths
 * @returns {{ lockPath: string, offenders: { name: string, resolved: string }[] }[]}
 */
export function checkLockfiles(lockPaths) {
  if (lockPaths.length === 0) {
    throw new Error('検査する lockfile が1本も見つかりませんでした。パスの指定を疑ってください。');
  }

  return lockPaths.map((lockPath) => ({
    lockPath,
    offenders: findForeignResolved(JSON.parse(readFileSync(lockPath, 'utf8'))),
  }));
}

// 直に実行されたときだけ検査して終了コードを返す
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const given = process.argv.slice(2);
  const lockPaths = given.length > 0 ? given : discoverLockfiles();

  let results;
  try {
    results = checkLockfiles(lockPaths);
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const bad = results.filter(({ offenders }) => offenders.length > 0);

  if (bad.length > 0) {
    console.error(
      '::error::npm レジストリ以外から依存を取ろうとしている lockfile があります。' +
        ' 認証情報の有無にかかわらず、動いたコードは id-token から AWS のロールに入れます。',
    );
    for (const { lockPath, offenders } of bad) {
      console.error(`  ${lockPath}`);
      for (const { name, resolved } of offenders) console.error(`    ${name} → ${resolved}`);
    }
    process.exit(1);
  }

  console.log(
    `${results.length} 本の lockfile を調べ、取得元はすべて ${ALLOWED_HOSTS.join(' / ')} でした。`,
  );
  for (const { lockPath } of results) console.log(`  ${lockPath}`);
}
