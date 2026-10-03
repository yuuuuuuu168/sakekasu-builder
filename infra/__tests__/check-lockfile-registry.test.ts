import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ALLOWED_HOSTS,
  MIN_LOCKFILE_VERSION,
  checkLockfiles,
  discoverLockfiles,
  findForeignResolved,
  findShapeProblems,
} from '../scripts/check-lockfile-registry.mjs';

/**
 * lockfile の取得元の検査。
 *
 * ワークフローは AWS の認証情報を入れる前に依存を取り、テストを走らせる。
 * lockfile の `resolved` を自前のターゲットへ向けられると、そこが任意コードの
 * 実行点になる。ジョブには id-token: write があるので、動いたコードは自分で
 * OIDC トークンを取って AWS のロールに入れる（PR #230 の指摘）。
 *
 * 見落としの歴史があるので、どの lockfile を見ているかも検査する。最初の版は
 * infra 本体しか見ておらず、`npm test` が import する lambda の9本が素通り
 * していた（HIGH の指摘）。
 */

const INFRA = new URL('..', import.meta.url).pathname;
const REGISTRY = 'https://registry.npmjs.org';

function lockWith(packages: Record<string, unknown>) {
  return { lockfileVersion: 3, packages: { '': { name: 'infra' }, ...packages } };
}

describe('findForeignResolved', () => {
  it('レジストリからの取得だけなら何も返さない', () => {
    const lock = lockWith({
      'node_modules/a': { resolved: `${REGISTRY}/a/-/a-1.0.0.tgz`, integrity: 'sha512-x' },
      'node_modules/b': { resolved: `${REGISTRY}/@scope/b/-/b-2.0.0.tgz`, integrity: 'sha512-y' },
    });

    expect(findForeignResolved(lock)).toEqual([]);
  });

  it('別のホストを指していたら返す', () => {
    const lock = lockWith({
      'node_modules/a': { resolved: `${REGISTRY}/a/-/a-1.0.0.tgz` },
      'node_modules/@go-to-k/cdkd': {
        resolved: 'https://example.invalid/cdkd.tgz',
        integrity: 'sha512-attacker',
      },
    });

    expect(findForeignResolved(lock)).toEqual([
      { name: 'node_modules/@go-to-k/cdkd', resolved: 'https://example.invalid/cdkd.tgz' },
    ]);
  });

  it.each([
    ['似ているが別ホスト', 'https://registry.npmjs.org.example.invalid/x.tgz'],
    ['サブドメイン', 'https://evil.registry.npmjs.org/x.tgz'],
    ['ファイル', 'file:///tmp/x.tgz'],
    ['git', 'git+ssh://git@example.invalid/x.git'],
    ['URL として読めない', 'not a url'],
  ])('弾く: %s', (_label, resolved) => {
    expect(findForeignResolved(lockWith({ 'node_modules/x': { resolved } }))).toHaveLength(1);
  });

  it('resolved を持たないものは対象外', () => {
    // 親の tarball に同梱される依存。個別には取りに行かない
    const lock = lockWith({
      'node_modules/a/node_modules/b': { version: '1.0.0' },
      'node_modules/c': { link: true },
    });

    expect(findForeignResolved(lock)).toEqual([]);
  });

  it('ルート自身は対象外', () => {
    expect(findForeignResolved({ packages: { '': { resolved: 'file:.' } } })).toEqual([]);
  });

  it('packages が無くても落ちない', () => {
    expect(findForeignResolved({})).toEqual([]);
  });
});

describe('discoverLockfiles', () => {
  it('infra 本体と lambda ごとの lockfile を集める', () => {
    const root = mkdtempSync(join(tmpdir(), 'lockfiles-'));
    writeFileSync(join(root, 'package-lock.json'), '{}');
    for (const name of ['alpha', 'beta']) {
      mkdirSync(join(root, 'lambda', name), { recursive: true });
      writeFileSync(join(root, 'lambda', name, 'package-lock.json'), '{}');
    }
    // lockfile を持たない lambda と、ディレクトリでないものは拾わない
    mkdirSync(join(root, 'lambda', 'no-lock'), { recursive: true });
    writeFileSync(join(root, 'lambda', 'README.md'), '');

    expect(discoverLockfiles(root).map((p) => p.slice(root.length + 1)).sort()).toEqual([
      'lambda/alpha/package-lock.json',
      'lambda/beta/package-lock.json',
      'package-lock.json',
    ]);
  });

  it('lambda ディレクトリが無くても落ちない', () => {
    const root = mkdtempSync(join(tmpdir(), 'lockfiles-'));
    writeFileSync(join(root, 'package-lock.json'), '{}');

    expect(discoverLockfiles(root)).toHaveLength(1);
  });

  it('何も無ければ空', () => {
    expect(discoverLockfiles(mkdtempSync(join(tmpdir(), 'lockfiles-')))).toEqual([]);
  });
});

describe('checkLockfiles', () => {
  it('1本も見つからないのは異常として落とす', () => {
    // 黙って何も検査しない状態が緑になるのを避ける
    expect(() => checkLockfiles([])).toThrow(/1本も見つかりませんでした/);
  });

  it('lockfile ごとに結果を返す', () => {
    const root = mkdtempSync(join(tmpdir(), 'lockfiles-'));
    const good = join(root, 'good.json');
    const bad = join(root, 'bad.json');
    writeFileSync(good, JSON.stringify(lockWith({ 'node_modules/a': { resolved: `${REGISTRY}/a` } })));
    writeFileSync(
      bad,
      JSON.stringify(lockWith({ 'node_modules/b': { resolved: 'https://example.invalid/b' } })),
    );

    expect(checkLockfiles([good, bad])).toEqual([
      { lockPath: good, offenders: [], problems: [] },
      {
        lockPath: bad,
        offenders: [{ name: 'node_modules/b', resolved: 'https://example.invalid/b' }],
        problems: [],
      },
    ]);
  });
});

describe('このリポジトリの lockfile', () => {
  const discovered = discoverLockfiles(INFRA);

  it('infra 本体と lambda の全部を見ている', () => {
    // 最初の版は infra 本体しか見ておらず、lambda の9本が素通りしていた。
    // deploy.yml は lambda ごとに npm ci し、npm test が
    // lambda/**/__tests__ を拾ってそれらのモジュールを import する
    const relative = discovered.map((p) => p.slice(INFRA.length)).sort();

    expect(relative).toContain('package-lock.json');
    expect(
      relative.filter((p) => p.startsWith('lambda/')).length,
      'lambda の lockfile を拾えていない',
    ).toBeGreaterThan(0);

    // lambda/*/package-lock.json の実数と一致するか
    const onDisk = discoverLockfiles(INFRA).filter((p) => p.includes('/lambda/'));
    expect(relative.filter((p) => p.startsWith('lambda/'))).toHaveLength(onDisk.length);
  });

  it('見つけた全部の取得元が許可したホスト', () => {
    for (const { lockPath, offenders, problems } of checkLockfiles(discovered)) {
      expect(offenders, `${lockPath} が別の取得元を指している`).toEqual([]);
      expect(problems, `${lockPath} の形が検査に向かない`).toEqual([]);
    }
  });

  it('許可するホストは npm レジストリだけ', () => {
    expect(ALLOWED_HOSTS).toEqual(['registry.npmjs.org']);
  });

  it('全部が受け付ける版の lockfile', () => {
    for (const lockPath of discovered) {
      const version = JSON.parse(readFileSync(lockPath, 'utf8')).lockfileVersion;
      expect(version, `${lockPath} の lockfileVersion が古い`).toBeGreaterThanOrEqual(
        MIN_LOCKFILE_VERSION,
      );
    }
  });
});

/**
 * 旧い形式での素通り。
 *
 * lockfileVersion 1 には `packages` が無く、取得元は入れ子の `dependencies`
 * にしかない。`packages` だけを見る検査は「0件」を返して緑になり、その裏で
 * `npm ci` は v1 の `resolved` から取る（PR #230 の指摘、HIGH 2件目）。
 */
describe('旧い形式の lockfile', () => {
  const v1 = {
    lockfileVersion: 1,
    dependencies: {
      a: { version: '1.0.0', resolved: `${REGISTRY}/a/-/a-1.0.0.tgz` },
      evil: {
        version: '9.9.9',
        resolved: 'https://evil.example.invalid/evil.tgz',
        integrity: 'sha512-attacker',
      },
      parent: {
        version: '1.0.0',
        resolved: `${REGISTRY}/parent/-/parent-1.0.0.tgz`,
        dependencies: {
          nested: { version: '1.0.0', resolved: 'https://also-evil.example.invalid/n.tgz' },
        },
      },
    },
  };

  it('入れ子の dependencies からも取得元を拾う', () => {
    expect(findForeignResolved(v1)).toEqual([
      { name: 'evil', resolved: 'https://evil.example.invalid/evil.tgz' },
      { name: 'parent > nested', resolved: 'https://also-evil.example.invalid/n.tgz' },
    ]);
  });

  it('版が古いこと自体を問題として挙げる', () => {
    expect(findShapeProblems(v1)).toHaveLength(1);
    expect(findShapeProblems(v1)[0]).toMatch(/lockfileVersion 1 は受け付けません/);
  });

  it('packages だけの v3 は問題なし', () => {
    expect(findShapeProblems(lockWith({}))).toEqual([]);
  });

  it.each([
    ['lockfileVersion が無い', { packages: {} }],
    ['lockfileVersion が文字列', { lockfileVersion: '3', packages: {} }],
  ])('%s なら問題として挙げる', (_label, lock) => {
    expect(findShapeProblems(lock)).not.toEqual([]);
  });

  it('packages も dependencies も無ければ問題として挙げる', () => {
    expect(findShapeProblems({ lockfileVersion: 3 })).toEqual([
      'packages も dependencies も無く、取得元を確かめられません。',
    ]);
  });

  it('checkLockfiles が problems を返し、CLI が落ちる材料になる', () => {
    const root = mkdtempSync(join(tmpdir(), 'lockfiles-'));
    const old = join(root, 'v1.json');
    writeFileSync(old, JSON.stringify(v1));

    const [result] = checkLockfiles([old]);

    expect(result.offenders).toHaveLength(2);
    expect(result.problems).toHaveLength(1);
  });
});
