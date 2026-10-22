// サインイン画面は OS やアプリの設定によらず黒に固定する。共通テーマ（theme/sakekasu-theme.css）は
// 色を :root の 1 か所に light-dark(ライト, ダーク) で書いているので、AuthPage.css は
// .signin-cover に color-scheme: dark を付けるだけで、中の --sk-* がダークの値になる。
// その前提が崩れないことと、テーマから引けずに書き写している青海波の金がずれないことを確かめる。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

/** 最初に見つかったセレクタのブロックの中身（コメントを除く） */
function blockBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`${selector} が見つかりません`);
  return css.slice(start, css.indexOf('}', start)).replace(/\/\*[\s\S]*?\*\//g, '');
}

/** ブロックから --name の宣言を取り出す */
function declarations(body: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars.set(m[1], m[2].replace(/\s+/g, ' ').trim().toLowerCase());
  }
  return vars;
}

/** 共通テーマの値をダークの 16 進に解く。light-dark() はダーク側を取り、var() は :root から引く */
function resolveDark(root: Map<string, string>, value: string): string | undefined {
  const ref = /^var\((--sk-[\w-]+)\)$/.exec(value);
  if (ref) {
    const target = root.get(ref[1]);
    return target === undefined ? undefined : resolveDark(root, target);
  }
  const ld = /^light-dark\((.*)\)$/.exec(value);
  // 引数は 16 進か var() なので、括弧の中にカンマは無い。最初のカンマで分ければよい
  if (ld) return resolveDark(root, ld[1].slice(ld[1].indexOf(',') + 1).trim());
  return value;
}

const theme = read('../../../../theme/sakekasu-theme.css');
const authPage = read('../components/AuthPage.css');

describe('サインイン画面の色', () => {
  it('.signin-cover は color-scheme: dark で、--sk-* を上書きしない', () => {
    const body = blockBody(authPage, '.signin-cover');
    expect(body).toMatch(/color-scheme:\s*dark;/);
    expect([...declarations(body).keys()].filter((name) => name.startsWith('--sk-'))).toEqual([]);
  });

  it('共通テーマの色は light-dark() で書かれている（color-scheme で切り替わる前提）', () => {
    const root = declarations(blockBody(theme, ':root'));
    expect(root.get('--sk-bg')).toMatch(/^light-dark\(/);
    expect(root.get('--sk-gold-line')).toMatch(/^light-dark\(/);
  });

  it('青海波の金は、共通テーマのダークの gold-line に透明度 0x40 を付けたもの', () => {
    const root = declarations(blockBody(theme, ':root'));
    const goldLine = resolveDark(root, root.get('--sk-gold-line') ?? '');
    const wave = declarations(blockBody(authPage, '.signin-cover')).get('--signin-wave-gold');
    expect(wave).toBe(`${goldLine}40`);
  });
});
