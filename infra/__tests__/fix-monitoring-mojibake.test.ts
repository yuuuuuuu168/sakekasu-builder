import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AuthStack } from '../lib/auth-stack.js';
import { ApiStack } from '../lib/api-stack.js';
import { MonitoringStack } from '../lib/monitoring-stack.js';
import {
  TEXT_FIELDS,
  buildPatch,
  collectTargets,
  isAsciiOnly,
  planRepairs,
  // @ts-expect-error -- 型定義の無い .mjs を読む
} from '../scripts/fix-monitoring-mojibake.mjs';

/**
 * 監視スタックの文字化けを直すスクリプトの検査。
 *
 * CloudFormation が非ASCII を `?` に置き換えていた分を Cloud Control で当て直す。
 * cdkd では直せない（deploy はテンプレートと state を比べるので差分が無く、
 * 0.291.31 の drift は該当する型の差分を検出しない）。
 *
 * 気をつけるのは2つ。直す文面を合成結果から引いていること（スクリプトに
 * 写し取ると `lib/monitoring-stack.ts` と二重管理になる）と、パッチが
 * 1プロパティの replace に留まっていること（全体を上書きすると、触って
 * いない項目まで state の値で塗り替えてしまう）。
 */

const here = path.dirname(url.fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(here, '../scripts/fix-monitoring-mojibake.mjs');

type Target = {
  logicalId: string;
  type: string;
  name: string;
  textKey: string;
  text: string;
};

function templateWith(resources: Record<string, unknown>) {
  return { Resources: resources };
}

describe('isAsciiOnly', () => {
  it.each([
    ['', true],
    ['OCR errors', true],
    ['{####}', true],
    ['ラベル OCR', false],
    ['（', false],
  ])('%s → %s', (value, expected) => {
    expect(isAsciiOnly(value)).toBe(expected);
  });
});

describe('collectTargets', () => {
  it('非ASCII を含む説明文だけを拾う', () => {
    const { targets } = collectTargets(
      templateWith({
        Japanese: {
          Type: 'AWS::CloudWatch::Alarm',
          Properties: { AlarmName: 'a', AlarmDescription: 'ラベル OCR が失敗' },
        },
        Ascii: {
          Type: 'AWS::CloudWatch::Alarm',
          Properties: { AlarmName: 'b', AlarmDescription: 'OCR failed' },
        },
        NoDescription: {
          Type: 'AWS::CloudWatch::Alarm',
          Properties: { AlarmName: 'c' },
        },
      }),
    );

    expect((targets as Target[]).map((t) => t.name)).toEqual(['a']);
  });

  it('扱わない型は拾わない', () => {
    const { targets } = collectTargets(
      templateWith({
        Table: {
          Type: 'AWS::DynamoDB::Table',
          Properties: { TableName: 't', AlarmDescription: '日本語' },
        },
      }),
    );

    expect(targets).toEqual([]);
  });

  it('物理名が解決できないものは対象から外し、理由を残す', () => {
    // Fn::Join などで組まれていると識別子を組み立てられない。黙って
    // 飛ばすと「直したつもりで直っていない」になるので、呼ぶ側に渡す
    const { targets, skipped } = collectTargets(
      templateWith({
        Computed: {
          Type: 'AWS::CloudWatch::Alarm',
          Properties: {
            AlarmName: { 'Fn::Join': ['', ['a', 'b']] },
            AlarmDescription: '日本語の説明',
          },
        },
      }),
    );

    expect(targets).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect((skipped as { logicalId: string }[])[0].logicalId).toBe('Computed');
  });

  it.each(Object.keys(TEXT_FIELDS))('%s を拾える', (type) => {
    const { nameKey, textKey } = (
      TEXT_FIELDS as Record<string, { nameKey: string; textKey: string }>
    )[type];

    const { targets } = collectTargets(
      templateWith({
        R: { Type: type, Properties: { [nameKey]: 'name', [textKey]: '日本語' } },
      }),
    );

    expect(targets).toHaveLength(1);
    expect((targets as Target[])[0].textKey).toBe(textKey);
  });
});

describe('buildPatch', () => {
  it('1プロパティの replace だけを作る', () => {
    expect(buildPatch('AlarmDescription', 'ラベル OCR が失敗')).toEqual([
      { op: 'replace', path: '/AlarmDescription', value: 'ラベル OCR が失敗' },
    ]);
  });

  it('パッチは1件に留まる', () => {
    // 全体を上書きする形に広げると、触っていない項目まで塗り替わる。
    // Cloud Control は実物を読んでからパッチを当てるので、1件に留めることが
    // 「他を触らない」の担保になっている
    expect(buildPatch('DisplayName', '酒カス 監視アラート')).toHaveLength(1);
  });
});

describe('planRepairs', () => {
  const targets = [
    { logicalId: 'A', type: 'AWS::CloudWatch::Alarm', name: 'a', textKey: 'AlarmDescription', text: '日本語' },
    { logicalId: 'B', type: 'AWS::CloudWatch::Alarm', name: 'b', textKey: 'AlarmDescription', text: '日本語' },
  ];

  it('一致しているものに repaired を立てる', () => {
    const plan = planRepairs(targets, (t: Target) => (t.name === 'a' ? '日本語' : '???'));

    expect(plan.map((p: { name: string; repaired: boolean }) => [p.name, p.repaired])).toEqual([
      ['a', true],
      ['b', false],
    ]);
  });
});

/**
 * 合成結果との突き合わせ。
 *
 * `cdk.out` は読まない。CI の `npm test` は合成より前に走るので、ファイルの
 * 有無に頼ると検査ごと素通りする。他のテストと同じくその場で合成する。
 */
describe('合成結果との突き合わせ', () => {
  const script = readFileSync(SCRIPT_PATH, 'utf8');

  function monitoringTemplate() {
    const app = new cdk.App();
    const env = { account: '111122223333', region: 'ap-northeast-1' };

    const auth = new AuthStack(app, 'sakekasu-dev-auth', { envName: 'dev', env });
    const api = new ApiStack(app, 'sakekasu-dev-api', {
      envName: 'dev',
      userPool: auth.userPool,
      env,
    });
    const monitoring = new MonitoringStack(app, 'sakekasu-dev-monitoring', {
      envName: 'dev',
      graphqlApi: api.graphqlApi,
      tables: [api.purchaseTable, api.drinkingTable],
      functions: [api.presignedUrlFunction, api.ocrAnalyzerFunction, api.tastingNoteFunction],
      ocrFunction: api.ocrAnalyzerFunction,
      imageDeleteFailMetricFilter: api.imageDeleteFailMetricFilter,
      signupNotifyFailMetricFilter: auth.signupNotifyFailMetricFilter,
      sommelierRuntimeArn:
        'arn:aws:bedrock-agentcore:ap-northeast-1:111122223333:runtime/sommelier_test-ABC123',
      siteUrl: 'https://example.com',
      userPoolId: auth.userPool.userPoolId,
      canaryUserPoolClientId: auth.canaryUserPoolClient.userPoolClientId,
      env,
    });

    return Template.fromStack(monitoring).toJSON();
  }

  it('直す文面をスクリプトに写し取っていない', () => {
    // 写し取ると lib/monitoring-stack.ts と二重管理になり、片方だけ直して
    // 食い違う。合成結果から引く作りを保つ
    const { targets } = collectTargets(monitoringTemplate());

    expect((targets as Target[]).length, '合成結果に非ASCII の説明文が無い').toBeGreaterThan(0);

    const copied = (targets as Target[])
      .filter((t) => script.includes(t.text))
      .map((t) => `${t.name}: ${t.text}`);

    expect(copied, 'スクリプトに文面が直書きされている').toEqual([]);
  });

  it('拾った対象が TEXT_FIELDS の型に収まっている', () => {
    const { targets, skipped } = collectTargets(monitoringTemplate());

    for (const target of targets as Target[]) {
      expect(Object.keys(TEXT_FIELDS)).toContain(target.type);
    }
    // 物理名が解決できないものが増えたら、識別子の組み立てを足す必要がある
    expect(skipped, '物理名を解決できない対象がある').toEqual([]);
  });
});
