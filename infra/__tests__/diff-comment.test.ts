import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/**
 * cdk-diff ワークフローが投稿するコメント本文の組み立ての検査。
 *
 * 入力は `cdkd diff` の出力で、中身は PR 側が決められる（コンストラクト ID、
 * プロパティ、タグ）。aws-security-agent から2回指摘を受けた箇所で、どちらも
 * 「本文に何を仕込まれても壊れないか」という話だった。
 *
 * 1. 固定の ``` で囲んでいたため、本文にバッククォート3つを混ぜると囲みが
 *    途中で閉じ、以降が CI ボット名義で生きた Markdown として描画された
 * 2. 1 を直して囲みを本文に合わせて伸ばしたところ、長いバッククォート列を
 *    仕込むと囲みも同じだけ伸び、コメント全体が GitHub の上限を超えて投稿が
 *    422 で落ちるようになった（差分コメントを消せる）
 */

const require_ = createRequire(import.meta.url);
const { buildComment, fenceFor, breakLongBacktickRuns, COMMENT_LIMIT, FENCE_MAX } = require_(
  '../scripts/diff-comment.cjs',
) as typeof import('../scripts/diff-comment.cjs');

const MARKER = '<!-- cdk-diff -->';
const BACKTICK = '`';

function build(raw: string, limit?: number): string {
  return buildComment({ raw, marker: MARKER, ...(limit === undefined ? {} : { limit }) });
}

/** 本文を囲んでいる行（開きの囲み）を取り出す */
function fenceOf(full: string): string {
  const lines = full.split('\n');
  const fence = lines.find((line) => /^`{3,}$/.test(line));
  expect(fence, `囲みの行が見つからない:\n${full.slice(0, 200)}`).toBeDefined();
  return fence as string;
}

/**
 * 上限は2段で守っている。`breakLongBacktickRuns` が長い連続を切り、
 * `fenceFor` が囲みの長さに頭を抑える。buildComment 経由だと前者だけで
 * 足りてしまい、後者が効いているかが見えない（外しても通る）。
 * 保険として残すなら、単体で効いていることを見ておく。
 */
describe('囲みの上限', () => {
  it('fenceFor は連続が長くても上限を超えない', () => {
    expect(fenceFor(BACKTICK.repeat(60000)).length).toBe(FENCE_MAX);
  });

  it('breakLongBacktickRuns は上限以上の連続を切る', () => {
    const broken = breakLongBacktickRuns(BACKTICK.repeat(FENCE_MAX + 10));

    expect(broken).toContain('​');
    expect(
      new RegExp(`\`{${FENCE_MAX},}`).test(broken),
      '上限以上の連続が残っている',
    ).toBe(false);
  });

  it('breakLongBacktickRuns は上限未満の連続を触らない', () => {
    const short = `tag: ${BACKTICK.repeat(FENCE_MAX - 1)}x`;

    expect(breakLongBacktickRuns(short)).toBe(short);
  });
});

describe('buildComment', () => {
  it('目印と見出しを先頭に置き、本文を囲む', () => {
    const full = build('Stack sakekasu-dev-auth\nThere were no differences');

    expect(full.startsWith(MARKER)).toBe(true);
    expect(full).toContain('## cdkd diff');
    expect(full).toContain('There were no differences');
    expect(fenceOf(full)).toBe(BACKTICK.repeat(3));
  });

  it('ANSI のエスケープシーケンスを落とす', () => {
    const esc = String.fromCharCode(27);
    const full = build(`${esc}[31mCdkdError: boom${esc}[0m`);

    expect(full).toContain('CdkdError: boom');
    expect(full.includes(esc), 'エスケープシーケンスが残っている').toBe(false);
  });

  describe('囲みが本文に閉じられない', () => {
    it.each([
      ['バッククォート無し', 'Stack foo'],
      ['単体', `name: ${BACKTICK}foo${BACKTICK}`],
      ['囲みと同じ3つ', `desc: ${BACKTICK.repeat(3)}\n## 差分なし`],
      ['5つ', `tag: ${BACKTICK.repeat(5)}x`],
      ['上限ちょうど', `tag: ${BACKTICK.repeat(FENCE_MAX)}x`],
      ['上限超え', `tag: ${BACKTICK.repeat(FENCE_MAX + 40)}x`],
    ])('%s', (_label, raw) => {
      const full = build(raw);
      const fence = fenceOf(full);
      const inner = full.slice(full.indexOf(`\n${fence}\n`) + fence.length + 2, -fence.length - 1);

      expect(fence.length, '囲みが3文字未満').toBeGreaterThanOrEqual(3);
      expect(
        inner.includes(fence),
        `本文が囲みと同じ並びを含んでいる。コメントが途中で閉じる`,
      ).toBe(false);
    });
  });

  it('囲みに上限があり、長い連続を仕込まれても上限を超えない', () => {
    // これが無いと囲みが本文と同じだけ伸びてコメント全体が上限を超え、
    // 投稿が 422 で落ちる（差分コメントを消せる）
    const full = build(`${BACKTICK.repeat(60000)}`);

    expect(fenceOf(full).length).toBeLessThanOrEqual(FENCE_MAX);
    expect(full.length, 'コメントが GitHub の上限を超えた').toBeLessThanOrEqual(COMMENT_LIMIT);
  });

  it.each([
    ['普通に長い出力', 'x'.repeat(200000)],
    ['バッククォートだけ', BACKTICK.repeat(200000)],
    ['バッククォートと本文が混ざる', `${BACKTICK.repeat(100000)}diff${BACKTICK.repeat(100000)}`],
  ])('上限を超えない: %s', (_label, raw) => {
    const full = build(raw);
    expect(full.length).toBeLessThanOrEqual(COMMENT_LIMIT);
  });

  it('長すぎる本文は切り詰めて、省略したと分かるようにする', () => {
    const full = build('y'.repeat(100000));

    expect(full).toContain('長すぎるため省略');
    expect(full.length).toBeLessThanOrEqual(COMMENT_LIMIT);
  });

  it('上限を超える組み立てになったら黙って投げずに落とす', () => {
    // limit の指定を誤ったときに 422 ではなくこちらで気づけるようにしてある
    expect(() => build('z'.repeat(70000), 70000)).toThrow(/上限を超えた/);
  });
});
