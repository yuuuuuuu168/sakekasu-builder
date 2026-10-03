import { describe, expect, it } from 'vitest';

import {
  ALLOWED_HOSTS,
  findForeignResolved,
  checkLockfile,
} from '../scripts/check-lockfile-registry.mjs';

/**
 * lockfile の取得元の検査。
 *
 * cdk-diff.yml は認証情報を入れたあとに PR 由来の cdkd を実行する。lockfile の
 * `resolved` を自前のターゲットへ向けられると、そこが任意コードの実行点になる
 * （PR #230 で aws-security-agent が指摘、MEDIUM）。
 */

const REGISTRY = 'https://registry.npmjs.org';

function lockWith(packages: Record<string, unknown>) {
  return { packages: { '': { name: 'infra' }, ...packages } };
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

describe('このリポジトリの lockfile', () => {
  it('infra/package-lock.json の取得元はすべて許可したホスト', () => {
    expect(checkLockfile(new URL('../package-lock.json', import.meta.url).pathname)).toEqual([]);
  });

  it('許可するホストは npm レジストリだけ', () => {
    expect(ALLOWED_HOSTS).toEqual(['registry.npmjs.org']);
  });
});
