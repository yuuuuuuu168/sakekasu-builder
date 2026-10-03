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
 * あるので、動いたコードは自分で OIDC トークンを取ってロールに入れる。認証
 * ステップより前かどうかは関係がない。だからこの検査は取得そのものより前に置く。
 *
 * 見るのは、認証情報の有無にかかわらずワークフローが取得・import する全部。
 * infra 本体と lambda ごとの lockfile。vitest.config の include が lambda 配下の
 * __tests__ を拾うため、`npm test` でそれらのモジュールと依存が読み込まれる。
 *
 * 取得元の在りかは lockfile の版で変わる。`packages` を見るだけでは v1 を
 * 取りこぼし、`packages` が無いので「0件」として緑になる。版の下限を要求し、
 * かつ旧来の入れ子 `dependencies` も歩く（同じ指摘の2件目）。
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
 * 受け付ける lockfileVersion の下限。
 *
 * 2 以上なら `packages` が正本になる。1 は `resolved` が入れ子の
 * `dependencies` にしか無く、`packages` を見る検査が素通りする。
 */
export const MIN_LOCKFILE_VERSION = 2;

/** 取得元として許されるか */
function isAllowed(resolved) {
  try {
    return ALLOWED_HOSTS.includes(new URL(resolved).host);
  } catch {
    // URL として読めないものは、そもそも素性が分からないので弾く
    return false;
  }
}

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
 * 旧来の入れ子 `dependencies` ツリーを歩いて `resolved` を集める。
 *
 * v1 はここにしか取得元が無い。v2 は `packages` と両方を持つ。
 *
 * @param {unknown} node
 * @param {string} path
 * @returns {{ name: string, resolved: string }[]}
 */
function walkLegacyDependencies(node, path = '') {
  if (node === null || typeof node !== 'object') return [];

  return Object.entries(node).flatMap(([name, dep]) => {
    if (dep === null || typeof dep !== 'object') return [];

    const here = path === '' ? name : `${path} > ${name}`;
    const found = [];

    const resolved = /** @type {{ resolved?: unknown }} */ (dep).resolved;
    if (typeof resolved === 'string' && resolved !== '' && !isAllowed(resolved)) {
      found.push({ name: here, resolved });
    }

    const nested = /** @type {{ dependencies?: unknown }} */ (dep).dependencies;
    return [...found, ...walkLegacyDependencies(nested, here)];
  });
}

/**
 * 許可していない取得元を指しているパッケージを集める。
 *
 * `packages`（v2 以降の正本）と、旧来の入れ子 `dependencies` の両方を見る。
 * `resolved` を持たないものは対象外で、親の tarball に同梱される依存。
 * `packages` のルート（空文字キー）も対象外で、プロジェクト自身を指す。
 *
 * @param {{ packages?: Record<string, unknown>, dependencies?: unknown }} lock
 * @returns {{ name: string, resolved: string }[]}
 */
export function findForeignResolved(lock) {
  const fromPackages = Object.entries(lock.packages ?? {})
    .filter(([name]) => name !== '')
    .flatMap(([name, pkg]) => {
      const resolved = /** @type {{ resolved?: unknown }} */ (pkg ?? {}).resolved;
      if (typeof resolved !== 'string' || resolved === '') return [];
      return isAllowed(resolved) ? [] : [{ name, resolved }];
    });

  return [...fromPackages, ...walkLegacyDependencies(lock.dependencies)];
}

/**
 * 取得元の在りかを確かめられる形の lockfile かを見る。
 *
 * @param {{ lockfileVersion?: unknown, packages?: unknown, dependencies?: unknown }} lock
 * @returns {string[]} 見つかった問題（空なら問題なし）
 */
export function findShapeProblems(lock) {
  const problems = [];
  const version = lock.lockfileVersion;

  if (typeof version !== 'number') {
    problems.push('lockfileVersion が数値で入っていません。lockfile として読めません。');
  } else if (version < MIN_LOCKFILE_VERSION) {
    problems.push(
      `lockfileVersion ${version} は受け付けません（${MIN_LOCKFILE_VERSION} 以上が要る）。` +
        ' 古い形式は取得元が入れ子の dependencies にしか無く、検査をすり抜けます。' +
        ' npm install で作り直してください。',
    );
  }

  if (lock.packages === undefined && lock.dependencies === undefined) {
    problems.push('packages も dependencies も無く、取得元を確かめられません。');
  }

  return problems;
}

/**
 * lockfile 群を検査する。
 *
 * 1本も見つからないのは異常として扱う。黙って何も検査しない状態が
 * 「緑」になるのを避ける。
 *
 * @param {string[]} lockPaths
 * @returns {{ lockPath: string, offenders: { name: string, resolved: string }[], problems: string[] }[]}
 */
export function checkLockfiles(lockPaths) {
  if (lockPaths.length === 0) {
    throw new Error('検査する lockfile が1本も見つかりませんでした。パスの指定を疑ってください。');
  }

  return lockPaths.map((lockPath) => {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    return {
      lockPath,
      offenders: findForeignResolved(lock),
      problems: findShapeProblems(lock),
    };
  });
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

  const bad = results.filter(({ offenders, problems }) => offenders.length + problems.length > 0);

  if (bad.length > 0) {
    console.error(
      '::error::lockfile の取得元を確かめられませんでした。' +
        ' 認証情報の有無にかかわらず、動いたコードは id-token から AWS のロールに入れます。',
    );
    for (const { lockPath, offenders, problems } of bad) {
      console.error(`  ${lockPath}`);
      for (const problem of problems) console.error(`    ${problem}`);
      for (const { name, resolved } of offenders) console.error(`    ${name} → ${resolved}`);
    }
    process.exit(1);
  }

  console.log(
    `${results.length} 本の lockfile を調べ、取得元はすべて ${ALLOWED_HOSTS.join(' / ')} でした。`,
  );
  for (const { lockPath } of results) console.log(`  ${lockPath}`);
}
