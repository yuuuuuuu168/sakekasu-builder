import { Template } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { AuthStack } from '../lib/auth-stack.js';
import { ApiStack } from '../lib/api-stack.js';
import { MonitoringStack } from '../lib/monitoring-stack.js';
import { HealthGlobalStack } from '../lib/health-global-stack.js';

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
    userPool: authStack.userPool,
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
    expect(importedNames(templates.api).size).toBeGreaterThan(0);
  });
});
