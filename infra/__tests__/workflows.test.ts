import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ワークフローが「AWS の認証情報を入れる前に合成を済ませる」形を保っているかの検査。
 *
 * --ignore-scripts が止めるのは npm のインストール時スクリプトだけで、CDK アプリの
 * コードは合成時に実行される。認証後に合成すると、PR に仕込んだ AWS SDK の呼び出しが
 * 認証情報付きで動く（PR #151 のセキュリティレビュー、Issue #131）。
 *
 * 合成を先に出しても、後段の cdkd が自分で合成し直したら意味が無い。CDKD_APP に
 * 合成済みのディレクトリを渡すことで、cdkd は cdk.json の app を読まずその成果物を使う。
 * この2つはどちらか片方が欠けると黙って穴が開くので、まとめて検査する。
 */

const WORKFLOW_DIR = join(import.meta.dirname, '..', '..', '.github', 'workflows');

const CREDENTIALS_ACTION = 'aws-actions/configure-aws-credentials';
const SYNTH_COMMAND = 'npx cdk synth --all';

function lineIndexOf(lines: string[], needle: string, what: string): number {
  const index = lines.findIndex((line) => line.includes(needle));
  expect(index, `${what} が見つからない: ${needle}`).toBeGreaterThanOrEqual(0);
  return index;
}

describe.each(['deploy.yml', 'cdk-diff.yml'])('%s', (file) => {
  const lines = readFileSync(join(WORKFLOW_DIR, file), 'utf8').split('\n');

  it('合成が認証情報の設定より前にある', () => {
    const synth = lineIndexOf(lines, SYNTH_COMMAND, '合成のステップ');
    const credentials = lineIndexOf(lines, CREDENTIALS_ACTION, '認証情報のステップ');

    expect(
      synth,
      `${SYNTH_COMMAND}（${synth + 1}行目）が ${CREDENTIALS_ACTION}（${credentials + 1}行目）より後にある。` +
        ' PR のコードが認証情報付きで合成時に実行される',
    ).toBeLessThan(credentials);
  });

  it('CDKD_APP に合成済みのディレクトリを渡している', () => {
    // 渡さないと cdkd が cdk.json の app を読んで合成し直し、
    // 認証前に合成した意味が無くなる
    expect(
      lines.some((line) => /^\s*CDKD_APP:\s*cdk\.out\s*$/.test(line)),
      'CDKD_APP: cdk.out が無い',
    ).toBe(true);
  });

  it('認証情報より後に CDK アプリを合成し直すコマンドが無い', () => {
    const credentials = lineIndexOf(lines, CREDENTIALS_ACTION, '認証情報のステップ');

    // --app / CDKD_APP で合成済みを食わせない cdk / cdkd の呼び出しを探す。
    // cdkd 側は環境変数で渡しているので、ここで見るのは CDK CLI のほう
    const offenders = lines
      .map((line, index) => ({ line: line.trim(), number: index + 1, index }))
      .filter(({ index }) => index > credentials)
      .filter(({ line }) => /\bnpx cdk (deploy|diff|synth)\b/.test(line))
      .filter(({ line }) => !line.includes('--app cdk.out'))
      .map(({ line, number }) => `${number}行目: ${line}`);

    expect(offenders, '合成済みを渡さない CDK CLI の呼び出しが認証後にある').toEqual([]);
  });
});

/**
 * パイプに流すコマンドが、パイプ元の失敗を飲み込まないかの検査。
 *
 * `cmd | tee file` の終了コードは tee のものになる。GitHub Actions の run は
 * bash -e で動くが、-e はパイプライン全体の最後のコマンドしか見ないため、
 * cmd が落ちてもステップは成功扱いになる。これで cdkd が権限不足で止まった
 * まま diff チェックが緑になった（PR #230）。
 */
describe('パイプの失敗検知', () => {
  const file = 'cdk-diff.yml';
  const source = readFileSync(join(WORKFLOW_DIR, file), 'utf8');

  it('tee に流す run に set -o pipefail がある', () => {
    const runs = [...source.matchAll(/ {8}run: \|\n((?: {10}.*\n)+)/g)].map((m) => m[1]);
    expect(runs.length, `${file} に複数行の run が無い`).toBeGreaterThan(0);

    const piped = runs.filter((block) => block.includes('| tee '));
    expect(piped.length, `${file} に tee へ流す run が無い`).toBeGreaterThan(0);

    for (const block of piped) {
      expect(
        block.includes('set -o pipefail'),
        `pipefail が無いので tee がパイプ元の失敗を飲み込む:\n${block}`,
      ).toBe(true);
    }
  });

  it('コメントの囲みが本文のバッククォートで閉じられない', () => {
    // cdkd diff の出力には PR 側が決められる値が入る。そこにバッククォート
    // 3つが混ざると囲みが途中で閉じ、以降が CI ボット名義のコメントで
    // 生きた Markdown として描画される（aws-security-agent の指摘）。
    //
    // 固定の ``` を使っていないことを確かめるだけでは弱いので、
    // ワークフローから囲みを決める2行を取り出して実際に動かす
    const longestLine = source.split('\n').find((l) => l.includes('const longest'));
    const fenceLine = source.split('\n').find((l) => l.includes('const fence'));
    expect(longestLine, '囲みの長さを決める行が無い').toBeDefined();
    expect(fenceLine, '囲みを組む行が無い').toBeDefined();

    const computeFence = new Function(
      'body',
      `${longestLine}\n${fenceLine}\nreturn fence;`,
    ) as (body: string) => string;

    const backtick = '`';
    for (const [label, body] of [
      ['バッククォート無し', 'Stack foo\n  [+] Bar'],
      ['囲みと同じ3つ', `description: ${backtick.repeat(3)}\n## 差分なし`],
      ['それより長い5つ', `tag: ${backtick.repeat(5)}x`],
      ['単体のバッククォート', `name: ${backtick}foo${backtick}`],
    ] as const) {
      const fence = computeFence(body);
      expect(fence.length, `${label}: 囲みが3文字未満`).toBeGreaterThanOrEqual(3);
      expect(
        body.includes(fence),
        `${label}: 本文が囲みと同じ並びを含んでいる。コメントが途中で閉じる`,
      ).toBe(false);
    }
  });

  it('diff の出力を投稿するステップが失敗時にも走る', () => {
    // pipefail で diff ステップが落ちたとき、既定だと後続が飛ばされて
    // エラー内容が PR に出ない。
    //
    // 探すのは YAML のキーとしての if。コメントに書いた "if: always()" に
    // 当たらないよう、行頭の空白のあとすぐ if: で始まる行だけを見る
    const guards = source
      .split('\n')
      .filter((line) => /^\s+if:/.test(line))
      .filter((line) => line.includes('always()'));

    expect(guards, 'always() を持つ if: のステップが無い').not.toEqual([]);
  });
});
