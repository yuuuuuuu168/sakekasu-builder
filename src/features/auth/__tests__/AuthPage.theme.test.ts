// サインイン画面を黒に固定するため、AuthPage.css は共通テーマのダークの値を
// 写して持っている。テーマ側が変わったときに置いていかれないよう、写した値が
// theme/sakekasu-theme.css のダークと一致することを確かめる。
//
// 共通テーマは色を :root の 1 か所に light-dark(ライト, ダーク) で書き、ブランドの色は
// var(--sk-indigo) などで引く。ここではその 2 つを解いてダークの 16 進にしてから比べる。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

/** 最初に見つかったセレクタのブロックから --sk-* の宣言を取り出す */
function skVars(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`${selector} が見つかりません`);
  const body = css.slice(start, css.indexOf('}', start));
  const vars = new Map<string, string>();
  for (const m of body.matchAll(/(--sk-[\w-]+)\s*:\s*([^;]+);/g)) {
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
  if (ld) {
    // 引数は 16 進か var() なので、括弧の中にカンマは無い。最初のカンマで分ければよい
    const comma = ld[1].indexOf(',');
    return resolveDark(root, ld[1].slice(comma + 1).trim());
  }
  return value;
}

describe('サインイン画面の色', () => {
  it('上書きしている --sk-* は、共通テーマのダークと同じ値', () => {
    const root = skVars(read('../../../../theme/sakekasu-theme.css'), ':root');
    const cover = skVars(read('../components/AuthPage.css'), '.signin-cover');

    expect(cover.size).toBeGreaterThan(0);
    for (const [name, value] of cover) {
      const themeValue = root.get(name);
      expect({ name, value }).toEqual({
        name,
        value: themeValue === undefined ? undefined : resolveDark(root, themeValue),
      });
    }
  });
});
