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

/**
 * `cdkd scrub` の置き場所。
 *
 * scrub は state の中身を見る前に `Fn::ImportValue` を解決する。参照先の Export が
 * state にも CloudFormation にも無いと「解決できないので清いとは言えない」と言って
 * 拒否する（ScrubRefusalError）。
 *
 * cdkd へ移した直後の state はリソースだけで、スタックの Output を持っていない。
 * それを書くのは最初の `cdkd deploy`。だから scrub をデプロイの前に置くと、
 * 移行の直後に必ずそこで止まる。2026-10-03 の初回デプロイで実際に止まった。
 *
 * 後ろに置いても見張りとしては弱くならない。平文を state に書くのは deploy
 * そのもので、前に見ているのは1回古い state でしかない。
 */
describe('deploy.yml の scrub の位置', () => {
  const lines = readFileSync(join(WORKFLOW_DIR, 'deploy.yml'), 'utf8').split('\n');

  it('scrub が cdkd deploy より後にある', () => {
    const deploy = lineIndexOf(lines, 'npx cdkd deploy --all', 'cdkd deploy のステップ');
    const scrub = lineIndexOf(lines, 'npx cdkd scrub --all', 'scrub のステップ');

    expect(
      scrub,
      `scrub（${scrub + 1}行目）が cdkd deploy（${deploy + 1}行目）より前にある。` +
        ' 参照先の Export が state に無い状態で ScrubRefusalError になり、デプロイに届かない',
    ).toBeGreaterThan(deploy);
  });

  it('scrub が deploy の失敗時にも走る', () => {
    // 途中で落ちた回こそ、state に何が残ったかを見たい。
    //
    // 見るのは YAML のキーとしての if。コメントの "always()" に当たらないよう、
    // 行頭の空白のあとすぐ if: で始まる行だけを見る
    const scrub = lineIndexOf(lines, 'npx cdkd scrub --all', 'scrub のステップ');
    const stepStart = lines
      .slice(0, scrub)
      .reduce((last, line, index) => (/^ {6}- /.test(line) ? index : last), 0);
    const step = lines.slice(stepStart, scrub + 1);

    expect(
      step.some((line) => /^\s+if:/.test(line) && line.includes('always()')),
      'scrub のステップに always() が無い。deploy が落ちた回に state を見られない',
    ).toBe(true);
  });
});

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

  it('合成のステップが CDK_DEFAULT_ACCOUNT を明示している', () => {
    // 本来 CDK CLI が認証情報から入れる値。認証前に合成すると undefined に
    // なり、bin/app.ts の env.account が未定義のスタックになって、
    // テンプレート中のアカウント ID が Ref: AWS::AccountId に化ける。
    // 認証ありで合成した場合と別物のテンプレートになる（Issue #131）
    const synth = lineIndexOf(lines, SYNTH_COMMAND, '合成のステップ');
    const credentials = lineIndexOf(lines, CREDENTIALS_ACTION, '認証情報のステップ');

    // 合成のステップの範囲（直前のステップ境界から合成の行まで）を見る
    const stepStart = lines
      .slice(0, synth)
      .reduce((last, line, index) => (/^ {6}- /.test(line) ? index : last), 0);
    const step = lines.slice(stepStart, synth + 1);

    expect(
      step.some((line) => /^\s*CDK_DEFAULT_ACCOUNT:/.test(line)),
      '合成のステップに CDK_DEFAULT_ACCOUNT が無い。' +
        '認証前の合成でテンプレートのアカウント ID が Ref: AWS::AccountId に化ける',
    ).toBe(true);
    expect(synth, '合成が認証より後にある').toBeLessThan(credentials);
  });

  it('lockfile の取得元の検査が、依存の取得と認証情報より前にある', () => {
    // lockfile は PR が書き換えられる。resolved を自前のターゲットへ向けると
    // 認証後に動く cdkd が PR のコードになる（aws-security-agent の指摘）。
    // 取得させる前に止めたいので npm ci より前、当然ながら認証より前
    const check = lineIndexOf(lines, 'check-lockfile-registry.mjs', '取得元の検査');
    const install = lineIndexOf(lines, 'npm ci --ignore-scripts', '依存の取得');
    const credentials = lineIndexOf(lines, CREDENTIALS_ACTION, '認証情報のステップ');

    expect(check, '取得元の検査が npm ci より後にある').toBeLessThan(install);
    expect(check, '取得元の検査が認証より後にある').toBeLessThan(credentials);
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

  it('コメントの組み立てを検査済みのモジュールに任せている', () => {
    // 本文は PR 側が中身を決められる。ワークフローに直書きすると単体で
    // 試せないので、diff-comment.cjs に出して検査してある
    // （infra/__tests__/diff-comment.test.ts）。
    // ここでは、ワークフローがそれを使っていること、組み立てを手元で
    // やり直していないことを見る
    expect(source, 'diff-comment.cjs を使っていない').toContain(
      'infra/scripts/diff-comment.cjs',
    );
    expect(source, 'buildComment を呼んでいない').toContain('buildComment(');

    // 囲みを直書きする形に戻っていないか
    const inlineFence = source
      .split('\n')
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }) => !line.startsWith('#') && !line.startsWith('//'))
      .filter(({ line }) => /\\`\\`\\`|'`'\.repeat|`{3}\\n\$\{body\}/.test(line))
      .map(({ line, number }) => `${number}行目: ${line}`);

    expect(inlineFence, '囲みをワークフローに直書きしている').toEqual([]);
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
