import { Template } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { AuthStack } from '../lib/auth-stack.js';
import { ApiStack } from '../lib/api-stack.js';
import { MonitoringStack } from '../lib/monitoring-stack.js';
import { HealthGlobalStack } from '../lib/health-global-stack.js';
import { TEST_SHARED_AUTH } from './shared-auth-fixture.js';

/**
 * scripts/migrate-to-cdkd.sh が並べている移行順を、実際の Export と ImportValue の
 * 向きと突き合わせる。
 *
 * CloudFormation は、他のスタックが Fn::ImportValue で読んでいる Export を持つ
 * スタックを消せない。`cdkd import --migrate-from-cloudformation` は取り込みの
 * 最後に DeleteStack を打つので、読む側を先に移し終えていないとそこで落ちる。
 * しかも落ちるのは「状態は書けたが CloudFormation のスタックは残っている」
 * という中途半端な位置で、復旧は手作業になる。
 *
 * 順番はスクリプトに直書きしてあるため、CDK 側でスタック間の参照を足したり
 * 向きを変えたりしたときに黙って壊れる。ここで気づけるようにしておく。
 */

const TEST_ACCOUNT = '111122223333';
const TEST_REGION = 'ap-northeast-1';
const RUNTIME_ARN =
  'arn:aws:bedrock-agentcore:ap-northeast-1:111122223333:runtime/sommelier_test-ABC123';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(here, '../scripts/migrate-to-cdkd.sh');

/** スクリプトの stacks=( ... ) から「接尾辞 リージョン」の並びを読む */
function scriptOrder(): { suffix: string; region: string }[] {
  const script = readFileSync(SCRIPT_PATH, 'utf8');
  const block = /^stacks=\(\n([\s\S]*?)^\)$/m.exec(script);
  expect(block, 'stacks=( ... ) が見つからない').not.toBeNull();

  return block![1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('"'))
    .map((line) => {
      const m = /^"\$\{prefix\}-(\S+)\s+(\S+)"$/.exec(line);
      expect(m, `行の形が読めない: ${line}`).not.toBeNull();
      return { suffix: m![1], region: m![2] };
    });
}

/** テンプレートが Export している名前 */
function exportedNames(template: Template): Set<string> {
  const outputs = template.toJSON().Outputs ?? {};
  return new Set(
    Object.values(outputs as Record<string, { Export?: { Name?: unknown } }>)
      .map((o) => o.Export?.Name)
      .filter((n): n is string => typeof n === 'string'),
  );
}

/** テンプレートが Fn::ImportValue で読んでいる名前 */
function importedNames(template: Template): Set<string> {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'Fn::ImportValue' && typeof value === 'string') found.add(value);
      walk(value);
    }
  };
  walk(template.toJSON());
  return found;
}

function synth() {
  const app = new cdk.App();
  const env = { account: TEST_ACCOUNT, region: TEST_REGION };

  const authStack = new AuthStack(app, 'sakekasu-dev-auth', { envName: 'dev', env });
  const apiStack = new ApiStack(app, 'sakekasu-dev-api', {
    envName: 'dev',
    sharedAuth: TEST_SHARED_AUTH,
    env,
  });
  const monitoringStack = new MonitoringStack(app, 'sakekasu-dev-monitoring', {
    envName: 'dev',
    graphqlApi: apiStack.graphqlApi,
    tables: [apiStack.purchaseTable, apiStack.drinkingTable],
    functions: [
      apiStack.presignedUrlFunction,
      apiStack.ocrAnalyzerFunction,
      apiStack.tastingNoteFunction,
    ],
    ocrFunction: apiStack.ocrAnalyzerFunction,
    imageDeleteFailMetricFilter: apiStack.imageDeleteFailMetricFilter,
    signupNotifyFailMetricFilter: authStack.signupNotifyFailMetricFilter,
    sommelierRuntimeArn: RUNTIME_ARN,
    siteUrl: 'https://example.com',
    userPoolId: authStack.userPool.userPoolId,
    canaryUserPoolClientId: authStack.canaryUserPoolClient.userPoolClientId,
    env,
  });
  const healthGlobalStack = new HealthGlobalStack(app, 'sakekasu-dev-health-global', {
    envName: 'dev',
    targetRegion: TEST_REGION,
    env: { account: TEST_ACCOUNT, region: 'us-east-1' },
  });

  return {
    auth: Template.fromStack(authStack),
    api: Template.fromStack(apiStack),
    monitoring: Template.fromStack(monitoringStack),
    'health-global': Template.fromStack(healthGlobalStack),
  } as const;
}

describe('migrate-to-cdkd.sh の移行順', () => {
  let templates: ReturnType<typeof synth>;
  let order: { suffix: string; region: string }[];

  beforeAll(() => {
    templates = synth();
    order = scriptOrder();
  });

  it('cdk deploy --all が出す4スタックを過不足なく並べている', () => {
    expect(order.map((s) => s.suffix).sort()).toEqual(
      ['api', 'auth', 'health-global', 'monitoring'],
    );
  });

  it('リージョンが CDK 側の指定と一致する', () => {
    const expected: Record<string, string> = {
      auth: 'ap-northeast-1',
      api: 'ap-northeast-1',
      monitoring: 'ap-northeast-1',
      'health-global': 'us-east-1',
    };
    for (const { suffix, region } of order) {
      expect(region, `${suffix} のリージョン`).toBe(expected[suffix]);
    }
  });

  /**
   * 読む側が先。S を消す時点で CloudFormation に残っているのは S より後ろの
   * スタックなので、「後ろのどれかが S の Export を読んでいる」状態が
   * あってはならない
   */
  it('Export を読んでいるスタックが、読まれる側より先に並んでいる', () => {
    const exportsOf = new Map(
      order.map(({ suffix }) => [suffix, exportedNames(templates[suffix as keyof typeof templates])]),
    );
    const importsOf = new Map(
      order.map(({ suffix }) => [suffix, importedNames(templates[suffix as keyof typeof templates])]),
    );

    for (let i = 0; i < order.length; i += 1) {
      for (let j = i + 1; j < order.length; j += 1) {
        const earlier = order[i].suffix;
        const later = order[j].suffix;
        const clash = [...importsOf.get(later)!].filter((name) =>
          exportsOf.get(earlier)!.has(name),
        );
        expect(
          clash,
          `${later} が ${earlier} の Export を読んでいるのに ${earlier} のほうが先に並んでいる。` +
            ` DeleteStack が落ちる: ${clash.join(', ')}`,
        ).toEqual([]);
      }
    }
  });

  /** 上の検査が素通りしていないことの確認。依存が実在しなければ順番の議論は無意味 */
  it('検査の前提として、スタック間の Export と ImportValue が実在する', () => {
    expect(exportedNames(templates.auth).size).toBeGreaterThan(0);
    expect(importedNames(templates.monitoring).size).toBeGreaterThan(0);
  });

  /**
   * 共通ログインへ移ったので、api は auth の UserPool を読まなくなった。
   * それでも auth は monitoring（カナリア）に UserPool の Export を出し続けるので、
   * デプロイ中に「読まれている Export を消す」形にはならない
   */
  it('api は auth の Export を読まず、auth の UserPool の Export は monitoring が読み続ける', () => {
    const authExports = exportedNames(templates.auth);
    expect([...importedNames(templates.api)].filter((name) => authExports.has(name))).toEqual([]);
    expect([...importedNames(templates.monitoring)].filter((name) => authExports.has(name)).length)
      .toBeGreaterThan(0);
  });
});

/**
 * Cloud Control の識別子が CloudFormation の物理 ID と違う型への手当て。
 *
 * cdkd は取り込むリソースの識別子に CloudFormation の物理 ID を使うが、Cloud
 * Control 側が別の形を求める型がある。そのままだと
 * 「Identifier ... is not valid for identifier [...]」で落ちる。
 *
 * 2026-10-03 の手順7 の前検査で5件当たった（auth の UserPoolClient 2つと
 * MetricFilter 1つ、api の MetricFilter 1つと GraphQLApi 1つ）。スクリプトが
 * --resource で明示して回避するので、その対象が落ちていないかを見る。
 *
 * UserPoolClient の件は go-to-k/cdkd#3701 で 0.291.23 修正済みと読んで一度
 * 回避を外したが、0.291.31 でも落ちた。手順5 の cdkd diff では出ず、
 * 取り込みで初めて出るため、この検査が唯一の歯止めになる。
 */
describe('migrate-to-cdkd.sh の識別子の手当て', () => {
  const script = readFileSync(SCRIPT_PATH, 'utf8');

  /** 物理 ID と Cloud Control の識別子が食い違う型と、スタックごとの個数 */
  const NEEDS_OVERRIDE = [
    { type: 'AWS::Cognito::UserPoolClient', counts: { auth: 2 } },
    { type: 'AWS::Logs::MetricFilter', counts: { auth: 1, api: 1 } },
    { type: 'AWS::AppSync::GraphQLApi', counts: { api: 1 } },
  ] as const;

  it.each(NEEDS_OVERRIDE.map((e) => e.type))('%s を手当てしている', (type) => {
    expect(
      script.includes(type),
      `${type} の識別子の解決がスクリプトから消えている。取り込みが` +
        ' 「Identifier ... is not valid for identifier」で落ちる',
    ).toBe(true);
  });

  it('--resource を渡すときは --auto も渡す', () => {
    // --resource を1つでも渡すと、指定したものしか取り込まなくなる。
    //
    // 見るのはコメントを除いたコード側。スクリプトの解説にも --auto と
    // 書いてあるので、素朴に全文を探すと引数から消えても気づけない
    const code = script
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');

    expect(code, '--resource を組み立てていない').toMatch(/--resource/);
    expect(code, '--auto が無いと指定した数件だけが取り込まれる').toMatch(/--auto/);
  });

  it('手当てが要るリソースの数が変わっていない', () => {
    // 増えていたら、その新顔でも識別子の解決が効くかを実物で確かめてから
    // ここの数を直す。黙って増やすと取り込みの途中で落ちる
    const templates = synth();

    for (const { type, counts } of NEEDS_OVERRIDE) {
      for (const [stack, expected] of Object.entries(counts)) {
        const found = Object.keys(
          templates[stack as keyof typeof templates].findResources(type),
        ).length;
        expect(
          found,
          `${stack} の ${type} が ${expected} 件から ${found} 件に変わった。` +
            ' identifier_overrides で解決できるか確かめてから数を直すこと',
        ).toBe(expected);
      }
    }
  });
});

/**
 * bash 3.2 で動くか。
 *
 * macOS に入っている bash はいまも 3.2 で、人間様が手元から打つのはそこ。
 * mapfile で配列に読む形で書いたところ、macOS では
 * 「mapfile: command not found」を出しながら --resource を1つも渡さずに走り、
 * 前検査が同じ失敗を繰り返した。警告が流れるだけで止まらないので気づきにくい。
 */
/**
 * スクリプト自身が打つ aws コマンドの資格情報。
 *
 * CI で渡ってくるのは `sakekasu-github-actions-deploy` の資格情報で、この
 * ロールは `sts:AssumeRole` しか持たない。実権限は `sakekasu-cdkd-deploy` に
 * ある。cdkd は CDKD_ROLE_ARN を自分で読んで引き受けるが、それはスクリプトの
 * aws コマンドには効かない。
 *
 * 2026-10-03、手順9 をマージした直後の deploy がここで落ちた
 * （DescribeStacks の AccessDenied）。素の `aws` を1つでも足すと同じ形で
 * 再発する。
 */
describe('migrate-to-cdkd.sh の aws 呼び出し', () => {
  const script = readFileSync(SCRIPT_PATH, 'utf8');
  const codeLines = script
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => !/^\s*#/.test(line));

  it('aws は aws_cli 経由で打つ（ロールを引き受ける sts だけが例外）', () => {
    // 素の `aws` は権限を持たないロールで走る。見逃すと AccessDenied で
    // deploy が止まる
    const bare = codeLines
      // `aws_cli` は「aws」の後ろが空白でないので \baws\s+ には当たらない
      .filter(({ line }) => /\baws\s+[a-z]/.test(line))
      .filter(({ line }) => !/\baws\s+sts\s+assume-role\b/.test(line))
      .map(({ line, number }) => `${number}行目: ${line.trim()}`);

    expect(bare, '素の aws を打っている。aws_cli を使うこと').toEqual([]);
  });

  it('aws_cli と引き受けの両方が残っている', () => {
    const code = codeLines.map(({ line }) => line).join('\n');

    expect(code, 'aws_cli が無い').toMatch(/aws_cli\(\)\s*\{/);
    expect(code, 'ロールを引き受けていない').toMatch(/aws sts assume-role/);
    expect(code, '引き受けに失敗したときに止めていない').toMatch(/を引き受けられませんでした/);
  });

  it('引き受けた資格情報を環境変数として外に出さない', () => {
    // export すると cdkd にも渡る。sakekasu-cdkd-deploy の信頼ポリシーは
    // sakekasu-github-actions-deploy だけを許しているので、そこから自分自身を
    // 引き受けようとして落ちる
    const exported = codeLines
      .filter(({ line }) => /^\s*export\s+AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)/.test(line))
      .map(({ line, number }) => `${number}行目: ${line.trim()}`);

    expect(exported, '資格情報を export すると cdkd の引き受けが壊れる').toEqual([]);
  });

  it('空配列の展開が bash 3.2 の set -u で落ちない書き方になっている', () => {
    // "${cdkd_env[@]}" と素直に書くと、CDKD_ROLE_ARN が無いとき
    // unbound variable で落ちる。手元から打つ経路が死ぬ
    const code = codeLines.map(({ line }) => line).join('\n');

    expect(code, 'cdkd_env の展開が素のまま').toMatch(
      /\$\{cdkd_env\[@\]\+"\$\{cdkd_env\[@\]\}"\}/,
    );
  });
});

/**
 * CloudFormation への戻しは、どのスタックもまだ移っていないときだけ。
 *
 * `pending` は「CloudFormation のスタックが残っているもの」しか集めない。
 * 移行済みのスタック（cdkd の状態があり CloudFormation のスタックは無い）は
 * そこに入らない。前検査が失敗したときにそのまま `engine=cfn` を返すと、
 * deploy が `cdk deploy --all` を打って移行済みのぶんまで対象にする。
 * CloudFormation から見ればスタックが存在しないので、ゼロから作りに行く。
 *
 * スクリプト冒頭が警告しているのと同じ事故になる。同じ名前の DynamoDB
 * テーブルや S3 バケットで落ちるか、Cognito の UserPool のように名前が
 * 重複できるものは2つ目を黙って作る（利用者のアカウントが空の新しい
 * プールに切り替わる）。
 */
describe('migrate-to-cdkd.sh の混在時の歯止め', () => {
  const script = readFileSync(SCRIPT_PATH, 'utf8');
  const code = script
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

  it('engine=cfn を返す前に移行済みのスタックを調べている', () => {
    const fallback = code.indexOf("engine=cfn");
    expect(fallback, 'engine=cfn を返す箇所が無い').toBeGreaterThan(0);

    // 直前のブロックで state を見ていること
    const before = code.slice(0, fallback);
    expect(before, '移行済みを集めていない').toMatch(/migrated\+=\(/);
    expect(before, 'cdkd の状態を見ていない').toMatch(/cdkd_state_exists/);
  });

  it('移行済みがあれば止める', () => {
    expect(code, '止める判定が無い').toMatch(/\$\{#migrated\[@\]\}.*-ne 0/);
    expect(script, '理由を出していない').toMatch(/CloudFormation へは戻しません/);
  });

  it('止めるときは engine= を書かない', () => {
    // engine= を書いてから exit すると、deploy 側がそれを読んで走ってしまう。
    // 歯止めから engine=cfn の行までに exit が挟まっていること
    const guard = code.indexOf('migrated+=(');
    const fallback = code.indexOf('engine=cfn');
    expect(guard).toBeGreaterThan(0);
    expect(fallback).toBeGreaterThan(guard);

    const between = code.slice(guard, fallback);
    expect(between, '歯止めと engine=cfn のあいだに exit が無い').toMatch(/exit 1/);
  });

  it('空配列の展開が bash 3.2 の set -u で落ちない', () => {
    // migrated が空のとき "${migrated[@]}" を素で展開すると unbound variable。
    // 数を見るだけの ${#migrated[@]} は空でも安全なので、そちらを使う
    const bare = code
      .split('\n')
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => /"\$\{migrated\[@\]\}"/.test(line))
      .filter(({ line }) => !/\$\{migrated\[@\]\+/.test(line))
      // echo の中で中身を並べるのは、その時点で空でないことが確かめてある
      .filter(({ line }) => !/::error::/.test(line))
      .map(({ line, number }) => `${number}行目: ${line.trim()}`);

    expect(bare, 'bash 3.2 の set -u で落ちる展開').toEqual([]);
  });
});

describe('migrate-to-cdkd.sh の bash 3.2 互換', () => {
  const script = readFileSync(SCRIPT_PATH, 'utf8');
  const code = script
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => !/^\s*#/.test(line));

  it.each([
    ['mapfile', /\bmapfile\b/],
    ['readarray', /\breadarray\b/],
    ['連想配列（declare -A / local -A）', /\b(declare|local|typeset)\s+-[A-Za-z]*A\b/],
    ['大文字小文字の展開（${x^^} / ${x,,}）', /\$\{[A-Za-z_][A-Za-z0-9_]*(\^\^|,,)/],
    ['&> によるリダイレクト', /[^0-9&]&>[^>]/],
  ])('%s を使っていない', (_label, pattern) => {
    const hits = code
      .filter(({ line }) => pattern.test(line))
      .map(({ line, number }) => `${number}行目: ${line.trim()}`);

    expect(hits, 'bash 3.2（macOS の既定）で動かない').toEqual([]);
  });

  it('--resource を組み立てられなかったら落とす', () => {
    // 組み立てに失敗したまま素通りすると、取り込めるはずのリソースが
    // 「識別子が不正」で落ちる。mapfile のときに実際そうなった
    expect(script).toMatch(/--resource を組み立てられませんでした/);
  });
});
