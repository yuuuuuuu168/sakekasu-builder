// Issue #112: Lambda のランタイムを一箇所に揃える
//
// ランタイムの廃止対応は「気づいたときには更新がブロックされている」種類の
// 作業なので、機械で見張る。Node.js 20 のときは AWS Health の通知が来るまで
// 誰も気づいていなかった。

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { Template } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
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

const here = path.dirname(url.fileURLToPath(import.meta.url));
const libDir = path.join(here, '../lib');

const env = { account: '111122223333', region: 'ap-northeast-1' };

/** アプリ本体・課金通知・DevOps Agent のすべてを合成する */
function synthAllTemplates(): Record<string, Template> {
  const app = new cdk.App();

  const authStack = new AuthStack(app, 'TestAuth', { envName: 'dev', env });
  const apiStack = new ApiStack(app, 'TestApi', {
    envName: 'dev',
    userPool: authStack.userPool,
    env,
  });
  const monitoringStack = new MonitoringStack(app, 'TestMonitoring', {
    envName: 'dev',
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
    envName: 'dev',
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

  return {
    auth: Template.fromStack(authStack),
    api: Template.fromStack(apiStack),
    monitoring: Template.fromStack(monitoringStack),
    devopsAgent: Template.fromStack(devopsAgentStack),
    billing: Template.fromStack(billingStack),
  };
}

describe('Lambda のランタイム', () => {
  // 合成に esbuild が走るため、既定の 5 秒では足りない
  const templates = synthAllTemplates();

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
});
