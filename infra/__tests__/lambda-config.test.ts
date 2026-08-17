// Lambda の設定のうち、全関数で揃っていないと困るものを横断で見張る。
//
// - ランタイム（Issue #112）: 廃止対応は「気づいたときには更新がブロックされて
//   いる」種類の作業。Node.js 20 のときは AWS Health の通知が来るまで誰も
//   気づいていなかった。
// - ログ保持期間（Issue #127 / #129）: 既定は無期限。本アプリのログには利用者の
//   Cognito sub が入りうるため、放置すると残り続ける。保持期間は明示的な
//   LogGroup で設定しているので、ロググループ側を見る。

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { Template } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack.js';
import { ApiStack } from '../lib/api-stack.js';
import { MonitoringStack } from '../lib/monitoring-stack.js';
import { BillingNotifierStack } from '../lib/billing-notifier-stack.js';
import { DevOpsAgentStack } from '../lib/devops-agent-stack.js';

/**
 * 全 Lambda が使うランタイム。
 *
 * 上限は CloudWatch Application Signals 側の対応状況で決まる。2026-08-10 時点で
 * Application Signals が対応するのは Node.js 18.x / 20.x / 22.x で、24.x は入って
 * いない。Issue #86 で presigned-url と ocr-analyzer に計装を入れ直す予定がある
 * ため、24 には上げない。
 * https://docs.aws.amazon.com/lambda/latest/dg/monitoring-application-signals.html
 *
 * nodejs22.x の廃止は 2027-04-30、更新ブロックは 2027-07-01。それまでに
 * Application Signals が 24 に対応していれば 24 へ上げる。
 */
const EXPECTED_RUNTIME = 'nodejs22.x';
const EXPECTED_CDK_ENUM = 'NODEJS_22_X';

/**
 * ログ保持期間（Issue #127）。値の根拠は lib/log-retention.ts のコメント。
 *
 * ここで定数を import せず数値を直接書いているのは、実装と同じ値を参照すると
 * 「実装を変えたらテストも一緒に変わる」ため検査にならないから。
 */
const EXPECTED_RETENTION_DAYS = 30;

/**
 * アカウントの Lambda 同時実行上限（2026-08-11 に 10 から引き上げ済み）。
 * `aws lambda get-account-settings` の ConcurrentExecutions と揃える。
 */
const ACCOUNT_CONCURRENCY_LIMIT = 1000;

/** AWS が要求する未予約枠の下限。予約の合計はこれを侵せない */
const MIN_UNRESERVED_CONCURRENCY = 100;

/**
 * 計装を入れた関数に持たせるメモリの下限（Issue #86）。
 *
 * 実測で Max Memory Used が 100MB 前後から 120MB へ増えた。既定の 128MB では
 * 残り 8MB になってしまうので、その倍は確保する。
 */
const MIN_INSTRUMENTED_MEMORY_MB = 256;

/**
 * テストでスタックを合成するときの環境名。
 *
 * 関数名は `{envName}-sakekasu-...` で組み立てられるため、期待値を書く側と
 * 合成する側で揃っていないと、名前が食い違って検査にならない
 */
const SYNTH_ENV_NAME = 'dev';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const libDir = path.join(here, '../lib');

/**
 * 生きているコードの中で正規表現に当たる行数を数える。
 *
 * 行コメントを除くのは、`logRetention` を一時的にコメントアウトしても
 * 数が合ってしまい、テストが通り続けるのを防ぐため。デバッグ中に
 * コメントアウトしたまま戻し忘れる、は普通に起きる。
 *
 * ブロックコメント（元の指摘には無いが同じ抜け道になる）も除く。
 */
function countLive(source: string, pattern: RegExp): number {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutBlockComments
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
      return pattern.test(trimmed);
    }).length;
}

const env = { account: '111122223333', region: 'ap-northeast-1' };

/**
 * Lambda を持つスタックのソースと、合成結果のキーの対応。
 *
 * ここを起点に「取りこぼしているスタックが無いか」を照合する。スタックごとに
 * 必要な props が大きく違うため（ApiStack は UserPool、MonitoringStack は
 * 10 個近く）、ファイル走査で機械的にインスタンス化する形は採らない。
 * 代わりに、対応表に載っていないスタックがあれば落ちるようにする。
 */
const STACKS_WITH_LAMBDA: Record<string, string> = {
  'api-stack.ts': 'api',
  'auth-stack.ts': 'auth',
  'monitoring-stack.ts': 'monitoring',
  'billing-notifier-stack.ts': 'billing',
  'devops-agent-stack.ts': 'devopsAgent',
};

/** アプリ本体・課金通知・DevOps Agent のすべてを合成する */
function synthAllTemplates(): {
  templates: Record<string, Template>;
  /** スタックのキー → デプロイ先アカウント ID */
  accounts: Record<string, string>;
} {
  const app = new cdk.App();

  const authStack = new AuthStack(app, 'TestAuth', { envName: SYNTH_ENV_NAME, env });
  const apiStack = new ApiStack(app, 'TestApi', {
    envName: SYNTH_ENV_NAME,
    userPool: authStack.userPool,
    env,
  });
  const monitoringStack = new MonitoringStack(app, 'TestMonitoring', {
    envName: SYNTH_ENV_NAME,
    graphqlApi: apiStack.graphqlApi,
    tables: [apiStack.purchaseTable, apiStack.drinkingTable],
    functions: [apiStack.presignedUrlFunction, apiStack.ocrAnalyzerFunction],
    ocrFunction: apiStack.ocrAnalyzerFunction,
    imageDeleteFailMetricFilter: apiStack.imageDeleteFailMetricFilter,
    signupNotifyFailMetricFilter: authStack.signupNotifyFailMetricFilter,
    sommelierRuntimeArn:
      'arn:aws:bedrock-agentcore:ap-northeast-1:111122223333:runtime/sommelier_test-ABC123',
    siteUrl: 'https://example.com',
    userPoolId: 'ap-northeast-1_TEST',
    canaryUserPoolClientId: 'canaryclientid',
    env,
  });

  const devopsAgentStack = new DevOpsAgentStack(app, 'TestDevOpsAgent', {
    envName: SYNTH_ENV_NAME,
    monitoringAccountId: '<運用アカウント ID>',
    agentSpaceArn: 'arn:aws:aidevops:ap-northeast-1:<運用アカウント ID>:agentspace/abc123',
    alertTopic: monitoringStack.alertTopic,
    env,
  });

  // 課金通知は管理アカウント側の別スタック。App を分けないと
  // 同一 App 内で env が食い違うため、こちらは独立して合成する
  const billingApp = new cdk.App();
  const billingStack = new BillingNotifierStack(billingApp, 'TestBillingNotifier', {
    targetAccounts: [{ id: '222222222222', label: 'sakekasu-builder（アプリ本体）' }],
    env: { account: '111111111111', region: 'ap-northeast-1' },
  });

  const stacks = {
    auth: authStack,
    api: apiStack,
    monitoring: monitoringStack,
    devopsAgent: devopsAgentStack,
    billing: billingStack,
  };

  return {
    templates: Object.fromEntries(
      Object.entries(stacks).map(([name, stack]) => [name, Template.fromStack(stack)]),
    ),
    // 同時実行の枠はアカウント単位で効く。どのスタックがどのアカウントへ
    // 行くかは合成時の env で決まるので、そこから機械的に拾う。
    // 手で一覧を持つと、スタックを足したときの書き漏れに気づけない
    accounts: Object.fromEntries(
      Object.entries(stacks).map(([name, stack]) => [name, stack.account]),
    ),
  };
}

describe('Lambda のランタイム', () => {
  // 合成に esbuild が走るため、既定の 5 秒では足りない
  const { templates, accounts } = synthAllTemplates();

  /** 全スタックを横断して、計装（起動ラッパー）が入っている関数を集める */
  const instrumentedFunctions = () =>
    Object.values(templates)
      .flatMap((template) => Object.values(template.findResources('AWS::Lambda::Function')))
      .filter(
        (fn) => fn.Properties?.Environment?.Variables?.AWS_LAMBDA_EXEC_WRAPPER !== undefined,
      );

  // 自前で定義した関数は functionName を必ず指定している。CDK が内部で作る
  // LogRetention や カスタムリソースのプロバイダーは指定しないので、
  // これでこちらの管理下にあるものだけを選り分けられる。
  // CDK 内製の関数のランタイムは CDK のバージョンに従うため、ここでは見ない
  it.each(Object.keys(templates))(
    `%s スタックの自前 Lambda がすべて ${EXPECTED_RUNTIME} を使う`,
    (name) => {
      const functions = Object.entries(
        templates[name].findResources('AWS::Lambda::Function'),
      ).filter(([, resource]) => resource.Properties?.FunctionName !== undefined);

      expect(
        functions.length,
        `${name} スタックに自前の Lambda が1つも見つからない（セットアップの誤りを疑う）`,
      ).toBeGreaterThan(0);

      for (const [logicalId, resource] of functions) {
        expect(
          resource.Properties.Runtime,
          `${logicalId} のランタイム`,
        ).toBe(EXPECTED_RUNTIME);
      }
    },
  );

  // 合成の対象一覧は手で書いているので、スタックを足した人がここに追記し忘れる
  // と、その関数は一切検査されない。ソース側と突き合わせて取りこぼしを防ぐ
  it('Lambda を持つスタックがすべて合成の対象になっている', () => {
    const filesWithLambda = readdirSync(libDir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => countLive(readFileSync(path.join(libDir, f), 'utf8'), /new NodejsFunction\(/) > 0);

    const missing = filesWithLambda.filter((f) => !(f in STACKS_WITH_LAMBDA));
    expect(
      missing,
      `Lambda を持つのに検査されていないスタックがある。STACKS_WITH_LAMBDA と`
        + ` synthAllTemplates() に追加すること:\n${missing.join('\n')}`,
    ).toEqual([]);

    // 逆向きも見る。対応表に書いたキーが実際に合成されていなければ、
    // 追加したつもりで検査されていない状態になる
    for (const [file, key] of Object.entries(STACKS_WITH_LAMBDA)) {
      expect(
        Object.keys(templates),
        `${file} に対応する "${key}" が合成結果に無い`,
      ).toContain(key);
    }
  });

  /**
   * そのスタックで自前の Lambda 向けに作っているロググループ。
   *
   * `/aws/lambda/` で絞るのは、Lambda 以外のロググループ（将来足したもの）を
   * 巻き込まないため。名前が既定から外れたロググループはここで落ちるので、
   * 絞ったぶんの見落としは下の照合が拾う
   */
  const lambdaLogGroups = (name: string) =>
    Object.entries(templates[name].findResources('AWS::Logs::LogGroup')).filter(
      ([, resource]) =>
        typeof resource.Properties?.LogGroupName === 'string'
        && resource.Properties.LogGroupName.startsWith('/aws/lambda/'),
    );

  // Issue #129 で Custom::LogRetention から明示的な LogGroup へ移した。
  // ロググループ名が `/aws/lambda/<関数名>` のままであることが移行の前提
  // （変わると docs/ の調査コマンドと運用手順が全部変わり、過去のログも
  // 旧グループに取り残される）なので、名前ごと突き合わせる。
  //
  // 集合で比べているため、指定漏れ（関数はあるのにロググループが無い）も
  // 余り（対応する関数が無いロググループ）も同時に捕まえられる
  it.each(Object.keys(templates))(
    '%s スタックの自前 Lambda に /aws/lambda/<関数名> のロググループがある',
    (name) => {
      const functionNames = Object.values(
        templates[name].findResources('AWS::Lambda::Function'),
      )
        .map((resource) => resource.Properties?.FunctionName)
        .filter((functionName): functionName is string => typeof functionName === 'string');

      expect(
        functionNames.length,
        `${name} スタックに自前の Lambda が1つも見つからない（セットアップの誤りを疑う）`,
      ).toBeGreaterThan(0);

      expect(lambdaLogGroups(name).map(([, resource]) => resource.Properties.LogGroupName).sort())
        .toEqual(functionNames.map((functionName) => `/aws/lambda/${functionName}`).sort());
    },
  );

  it.each(Object.keys(templates))(
    `%s スタックのロググループが ${EXPECTED_RETENTION_DAYS} 日で期限切れになる`,
    (name) => {
      const logGroups = lambdaLogGroups(name);

      expect(
        logGroups.length,
        `${name} スタックに Lambda のロググループが無い（logGroup の指定漏れを疑う）`,
      ).toBeGreaterThan(0);

      for (const [logicalId, resource] of logGroups) {
        expect(
          resource.Properties.RetentionInDays,
          `${logicalId} の保持期間`,
        ).toBe(EXPECTED_RETENTION_DAYS);
      }
    },
  );

  // スタックを消したときにログまで道連れにしない（Issue #129）。保持期間で
  // 自然に消える以上、削除まで CloudFormation に任せる理由が無い。
  // また、この移行は `cdk import` で既存のロググループを取り込む前提なので、
  // Retain が外れると取り込んだ実物を消しにいく形になる
  it.each(Object.keys(templates))('%s スタックのロググループを残して消す', (name) => {
    for (const [logicalId, resource] of lambdaLogGroups(name)) {
      expect(resource.DeletionPolicy, `${logicalId} の DeletionPolicy`).toBe('Retain');
      expect(resource.UpdateReplacePolicy, `${logicalId} の UpdateReplacePolicy`).toBe('Retain');
    }
  });

  // 非推奨の logRetention へ戻っていないことを見る。戻ると Custom::LogRetention
  // とそのプロバイダー Lambda が復活し、cdk diff の警告も戻ってくる
  it.each(Object.keys(templates))('%s スタックに Custom::LogRetention が無い', (name) => {
    expect(Object.keys(templates[name].findResources('Custom::LogRetention'))).toEqual([]);
  });

  // 上のテストは「合成したスタック」しか見られないので、新しいスタックを
  // 足した人がここに追記し忘れると素通りする。ソースを直接見ることで、
  // 追記を忘れても古いランタイムの混入は捕まえられるようにしておく
  it('infra/lib のランタイム指定がすべて同じ定数を指している', () => {
    const offenders: string[] = [];

    for (const file of readdirSync(libDir).filter((f) => f.endsWith('.ts'))) {
      const lines = readFileSync(path.join(libDir, file), 'utf8').split('\n');
      lines.forEach((line, i) => {
        const match = line.match(/Runtime\.(NODEJS_\w+)/);
        if (match && match[1] !== EXPECTED_CDK_ENUM) {
          offenders.push(`${file}:${i + 1} → Runtime.${match[1]}`);
        }
      });
    }

    expect(
      offenders,
      `Runtime.${EXPECTED_CDK_ENUM} 以外が使われている:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  // 同じ理由で、ロググループの指定漏れもソースから見る。関数を1つ足して
  // logGroup だけ書き忘れる、が一番ありそうな漏れ方。
  //
  // 直に `new logs.LogGroup` を書く形も数としては通ってしまうため、
  // ヘルパー経由に限定する。名前・保持期間・RemovalPolicy の3つが
  // 揃っていることは lambdaLogGroup の側で保証している
  it('infra/lib の NodejsFunction がすべてロググループを指定している', () => {
    let functions = 0;
    let withLogGroup = 0;
    const files: string[] = [];

    for (const file of readdirSync(libDir).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(path.join(libDir, file), 'utf8');
      const fnCount = countLive(source, /new NodejsFunction\(/);
      const logGroupCount = countLive(source, /logGroup:\s*lambdaLogGroup\(/);

      functions += fnCount;
      withLogGroup += logGroupCount;
      if (fnCount !== logGroupCount) {
        files.push(`${file}: NodejsFunction ${fnCount} 個に対し指定 ${logGroupCount} 個`);
      }
    }

    expect(functions, 'NodejsFunction が1つも見つからない（走査の誤りを疑う）').toBeGreaterThan(0);
    expect(files, `ロググループの指定が足りていない:\n${files.join('\n')}`).toEqual([]);
    expect(withLogGroup).toBe(functions);
  });

  // 非推奨の logRetention はもう使わない（Issue #129）。CDK v3 で消えるので、
  // 新しい関数を足すときにうっかり戻すと、同じ移行をもう一度やることになる。
  // 合成結果の側でも見ているが、合成の対象に入っていないスタック
  // （health-global など）まで届くのはソース走査のほうだけ
  it('infra/lib に非推奨の logRetention が残っていない', () => {
    const offenders: string[] = [];

    for (const file of readdirSync(libDir).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(path.join(libDir, file), 'utf8');
      if (countLive(source, /\blogRetention:/) > 0) offenders.push(file);
    }

    expect(
      offenders,
      `logRetention は非推奨。lambdaLogGroup() を使うこと:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  // 予約済み同時実行数はアカウント単位で効くので、1 スタックの中だけを見ても
  // 全体は分からない。
  //
  // 課金通知は管理アカウント側へ行くスタックで、同時実行の枠も別勘定になる。
  // アプリ本体の合計に混ぜると、どちらのアカウントも余裕があるのに合計だけが
  // 超えて落ちたり、逆に管理アカウント側の超過を見逃したりする。
  //
  // 振り分けは合成時のアカウントから決める。一覧を手で持つと、スタックを
  // 足したときにどちらかへ書き漏らして、予約が数えられなかったり
  // 別アカウント分が混ざったりする
  const APP_ACCOUNT_STACKS = Object.keys(accounts).filter(
    (name) => accounts[name] === env.account,
  );
  const OTHER_ACCOUNT_STACKS = Object.keys(accounts).filter(
    (name) => accounts[name] !== env.account,
  );

  /** そのスタックに置かれた予約を「関数名 → 予約数」で集める */
  function collectReservations(stackNames: string[]): Record<string, number> {
    const reservations: Record<string, number> = {};

    for (const name of stackNames) {
      const functions = templates[name].findResources('AWS::Lambda::Function');
      for (const fn of Object.values(functions)) {
        const reserved = fn.Properties?.ReservedConcurrentExecutions;
        const functionName = fn.Properties?.FunctionName;

        // CDK が内部で作る関数（LogRetention など）は名前を持たない。
        // 名前で突き合わせるので、こちらの管理下にあるものだけを見る
        if (typeof reserved !== 'number' || typeof functionName !== 'string') {
          continue;
        }

        // 論理 ID は CDK の構成で変わるため、関数名を鍵にする
        reservations[functionName] = reserved;
      }
    }

    return reservations;
  }

  /**
   * 予約を入れている関数と、その数。
   *
   * 合計だけを見張っても、1 つ消えて別の 1 つが残っていれば気づけない。
   * どちらも別々の理由で入れている（OCR は Bedrock の費用、DevOps Agent は
   * 調査が一斉に立ち上がるのを防ぐため）ので、消えたら落ちるようにする。
   * 予約を足したり外したりするときは、ここも一緒に直すこと
   */
  const EXPECTED_RESERVATIONS: Record<string, number> = {
    [`${SYNTH_ENV_NAME}-sakekasu-ocr-analyzer`]: 20,
    [`${SYNTH_ENV_NAME}-sakekasu-devops-agent-webhook`]: 2,
  };

  // 振り分けが壊れると、以降の検査が「対象ゼロ」で素通りしてしまう。
  // 両側に中身があることを先に固定しておく
  it('スタックがアカウントごとに振り分けられている', () => {
    expect(APP_ACCOUNT_STACKS, 'アプリ本体側のスタックが1つも無い').not.toEqual([]);
    expect(OTHER_ACCOUNT_STACKS, '別アカウント側のスタックが1つも無い').not.toEqual([]);

    // 合成したスタックはどちらかに必ず入る（取りこぼしが無い）
    expect([...APP_ACCOUNT_STACKS, ...OTHER_ACCOUNT_STACKS].sort()).toEqual(
      Object.keys(templates).sort(),
    );
  });

  it('予約を入れている関数と数が想定どおり', () => {
    expect(collectReservations(APP_ACCOUNT_STACKS)).toEqual(EXPECTED_RESERVATIONS);
  });

  // AWS は未予約枠を 100 以上残すことを要求するため、合計が上限 −100 を
  // 超えると apply で落ちる。別のスタックに予約を足したときに CI で気づける
  // ようにしておく（予約の効果と付ける基準は api-stack.ts のコメントを参照）
  it('予約の合計が未予約枠を 100 以上残す', () => {
    const reservations = collectReservations(APP_ACCOUNT_STACKS);
    const total = Object.values(reservations).reduce((sum, value) => sum + value, 0);
    const detail = Object.entries(reservations)
      .map(([name, value]) => `${name}: ${value}`)
      .join('\n');

    expect(
      total,
      `予約の合計が多すぎる（アカウント上限 ${ACCOUNT_CONCURRENCY_LIMIT}）:\n${detail}`,
    ).toBeLessThanOrEqual(ACCOUNT_CONCURRENCY_LIMIT - MIN_UNRESERVED_CONCURRENCY);
  });

  // 管理アカウント側は枠が別勘定で、上限もこちらでは確かめられない。
  // 予約を入れる時点で向こうの空きを確認してほしいので、
  // 「入れていない」ことを固定しておく（入れたらここが落ちる）
  it('管理アカウント側のスタックは予約を入れていない', () => {
    expect(collectReservations(OTHER_ACCOUNT_STACKS)).toEqual({});
  });

  // Issue #86: 計装を入れるのは api スタックの2関数だけ。監視系
  // （health-check / slack-notifier / sommelier-canary / signup-notifier）は
  // 意図的に対象外にしている。監視の監視は既存のアラームで足りていて、
  // 広げるとノイズと費用だけが増えるため。
  //
  // 対象は api-stack.test.ts でも見ているが、そちらは api スタックしか
  // 合成しないので「他のスタックへ広がっていない」ことは見られない。
  // 判断そのものを docs/application-signals.md に書いてあるので、
  // 増やすときは文書ごと更新してほしい。その合図としてここで固定する
  it('Application Signals の計装は対象の2関数だけに入っている', () => {
    const instrumented = instrumentedFunctions()
      .map((fn) => fn.Properties?.FunctionName)
      .sort();

    expect(instrumented).toEqual([
      `${SYNTH_ENV_NAME}-sakekasu-ocr-analyzer`,
      `${SYNTH_ENV_NAME}-sakekasu-presigned-url`,
    ]);
  });

  // 計装のレイヤーはメモリを 20MB ほど余分に使う（Issue #86 の実測）。
  // 既定の 128MB のままだと余裕が 8MB しか残らず、超えれば invocation ごと
  // OOM で落ちる。加えて Lambda は割り当てメモリに比例して CPU を配るので、
  // 128MB のままだとレイヤーぶんコールドスタートが伸びたままになる。
  //
  // 値そのものではなく「既定のままにしない」を見ている。関数ごとに適正な値は
  // 違うが、計装を足すときにメモリを考えていない状態は共通して困る
  it.each([
    `${SYNTH_ENV_NAME}-sakekasu-ocr-analyzer`,
    `${SYNTH_ENV_NAME}-sakekasu-presigned-url`,
  ])('%s は計装ぶんを見込んでメモリを明示している', (functionName) => {
    const [fn] = instrumentedFunctions().filter(
      (f) => f.Properties?.FunctionName === functionName,
    );

    expect(fn, `${functionName} が計装されていない`).toBeDefined();
    expect(
      fn.Properties?.MemorySize,
      `${functionName} が既定のメモリ（128MB）のまま`,
    ).toBeGreaterThanOrEqual(MIN_INSTRUMENTED_MEMORY_MB);
  });
});
