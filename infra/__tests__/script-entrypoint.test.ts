import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as url from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `infra/scripts/*.mjs` の「直に実行されたときだけ本体を走らせる」判定の検査。
 *
 * `import.meta.url` を `new URL("file://" + process.argv[1]).href` と比べると、
 * パスに `~` が入ったときに偽になる。`import.meta.url` は `~` を `%7E` に
 * 符号化するが、`new URL` はそのまま残すため。判定が偽になると本体が走らず、
 * **何も出さずに exit 0 で終わる**。失敗が見えないので、打った側は通ったと思う。
 *
 * iCloud Drive のパスには `com~apple~CloudDocs` が必ず入る。2026-10-03 に
 * 人間様の手元で踏んだ。`fix-monitoring-mojibake.mjs` が黙って終わり、
 * 文字化けが直らないまま「直した」ことになりかけた。
 *
 * `check-lockfile-registry.mjs` も同じ書き方だった。こちらは CI でしか走らず
 * ランナーのパスに `~` が無いため表に出ていなかったが、取得元を確かめる
 * 関門が黙って素通りする形なので性質はより悪い。
 *
 * 正しい逆変換は `pathToFileURL`。
 */

const here = path.dirname(url.fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.join(here, '../scripts');

/** iCloud Drive と同じ形のパスに置いて実行する */
function runFromTildePath(scriptName: string) {
  const base = mkdtempSync(path.join(tmpdir(), 'entrypoint-'));
  const dir = path.join(base, 'Mobile Documents', 'com~apple~CloudDocs', 'infra', 'scripts');
  mkdirSync(dir, { recursive: true });

  const copied = path.join(dir, scriptName);
  copyFileSync(path.join(SCRIPTS_DIR, scriptName), copied);

  try {
    const stdout = execFileSync(process.execPath, [copied], {
      cwd: path.dirname(dir),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { output: stdout, status: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; status?: number };
    return { output: (e.stdout ?? '') + (e.stderr ?? ''), status: e.status ?? -1 };
  }
}

const SCRIPTS = readdirSync(SCRIPTS_DIR).filter((name) => name.endsWith('.mjs'));

describe('scripts/*.mjs の実行判定', () => {
  it('検査対象の .mjs が存在する', () => {
    expect(SCRIPTS.length, 'scripts/ に .mjs が無い').toBeGreaterThan(0);
  });

  it.each(SCRIPTS)('%s がパスの符号化に依らない判定になっている', (name) => {
    const source = readFileSync(path.join(SCRIPTS_DIR, name), 'utf8');
    const offenders = source
      .split('\n')
      .map((line, index) => ({ line, number: index + 1 }))
      // コメントで経緯として書いてあるぶんは除く
      .filter(({ line }) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .filter(({ line }) => /new URL\(\s*`file:\/\//.test(line))
      .map(({ line, number }) => `${number}行目: ${line.trim()}`);

    expect(offenders, 'パスに ~ が入ると本体が黙って走らなくなる').toEqual([]);
  });

  it.each(SCRIPTS)('%s を ~ を含むパスから実行しても本体が走る', (name) => {
    // 何を出すかは問わない。「何かを出して非ゼロで終わる」ことで、入口の
    // 判定が通って本体に入ったと分かる。どのスクリプトも引数や前提ファイルが
    // 無ければエラーを出して落ちる
    const { output, status } = runFromTildePath(name);

    expect(
      output.trim(),
      `${name} が ~ を含むパスで何も出さずに終わった。入口の判定が偽になっている`,
    ).not.toBe('');
    expect(status, `${name} が前提なしで成功として終わった`).not.toBe(0);
  });
});
