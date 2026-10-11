// サインイン画面を黒に固定するため、AuthPage.css は共通テーマのダークの値を
// 写して持っている。テーマ側が変わったときに置いていかれないよう、写した値が
// theme/sakekasu-theme.css の `:root[data-theme='dark']` と一致することを確かめる。

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
    vars.set(m[1], m[2].trim().toLowerCase());
  }
  return vars;
}

describe('サインイン画面の色', () => {
  it('上書きしている --sk-* は、共通テーマのダークと同じ値', () => {
    const theme = skVars(read('../../../../theme/sakekasu-theme.css'), ":root[data-theme='dark']");
    const cover = skVars(read('../components/AuthPage.css'), '.signin-cover');

    expect(cover.size).toBeGreaterThan(0);
    for (const [name, value] of cover) {
      expect({ name, value }).toEqual({ name, value: theme.get(name) });
    }
  });
});
