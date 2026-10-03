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
