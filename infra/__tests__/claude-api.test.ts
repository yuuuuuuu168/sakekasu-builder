import { describe, it, expect } from 'vitest';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { ApiStack } from '../lib/api-stack.js';
import { MonitoringStack } from '../lib/monitoring-stack.js';
import { GithubOidcStack } from '../lib/github-oidc-stack.js';
import { ROLE_BOUNDARY_NAME } from '../lib/role-boundary.js';
import { parseAnthropicFederation, type AnthropicFederation } from '../lib/anthropic-federation.js';
import { TEST_SHARED_AUTH } from './shared-auth-fixture.js';

/**
 * OCR とテイスティングノートの呼び先を Claude API に切り替えた分の検査。
 *
 * - Claude Console のルールはロールの ARN の前方一致（sakekasu-{env}-llm-）で照合する。
 *   名前がずれると、エラーにならないまま毎回 Bedrock へ回る
 * - STS の ID トークンの権限は、ID 連携の値があるときだけ、宛先を Anthropic に絞って付ける
 * - Permissions Boundary は STS を拒否したまま、Anthropic 宛ての ID トークンだけを通す
 */

const ACCOUNT = '111111111111';
const env = { account: ACCOUNT, region: 'ap-northeast-1' };

const FEDERATION: AnthropicFederation = {
  ruleId: 'fdrl_01TestRule',
  organizationId: '00000000-0000-4000-8000-000000000000',
  serviceAccountId: 'svac_01TestAccount',
  workspaceId: 'wrkspc_01TestWorkspace',
};

const HERE = path.dirname(url.fileURLToPath(import.meta.url));

function apiTemplate(anthropicFederation?: AnthropicFederation): Template {
  const app = new cdk.App();
  const stack = new ApiStack(app, 'sakekasu-dev-api', {
    envName: 'dev',
    sharedAuth: TEST_SHARED_AUTH,
    anthropicFederation,
    env,
  });
  return Template.fromStack(stack);
}

type FunctionResource = {
  Properties: {
    Role: { 'Fn::GetAtt': [string, string] };
    Environment: { Variables: Record<string, unknown> };
  };
};

function functionNamed(template: Template, functionName: string): FunctionResource {
  const [fn] = Object.values(
    template.findResources('AWS::Lambda::Function', { Properties: { FunctionName: functionName } }),
  );
  expect(fn, `${functionName} が見つからない`).toBeDefined();
  return fn as FunctionResource;
}

/** そのロールに付いたインラインポリシーの文をすべて集める */
function statementsOfRole(template: Template, roleLogicalId: string): Record<string, unknown>[] {
  return Object.values(template.findResources('AWS::IAM::Policy'))
    .filter((policy) =>
      (policy as { Properties: { Roles: { Ref: string }[] } }).Properties.Roles.some(
        (role) => role.Ref === roleLogicalId,
      ),
    )
    .flatMap(
      (policy) =>
        (policy as { Properties: { PolicyDocument: { Statement: Record<string, unknown>[] } } })
          .Properties.PolicyDocument.Statement,
    );
}

const LLM_FUNCTIONS = [
  { functionName: 'dev-sakekasu-ocr-analyzer', roleName: 'sakekasu-dev-llm-ocr-analyzer', modelEnv: 'ANTHROPIC_MODEL_OCR' },
  { functionName: 'dev-sakekasu-tasting-note', roleName: 'sakekasu-dev-llm-tasting-note', modelEnv: 'ANTHROPIC_MODEL_NOTE' },
] as const;

describe('Claude を呼ぶ Lambda の実行ロール', () => {
  const template = apiTemplate(FEDERATION);

  for (const { functionName, roleName } of LLM_FUNCTIONS) {
    it(`${functionName} のロール名を ${roleName} に固定する`, () => {
      const fn = functionNamed(template, functionName);
      const roleLogicalId = fn.Properties.Role['Fn::GetAtt'][0];
      const role = template.findResources('AWS::IAM::Role')[roleLogicalId] as {
        Properties: { RoleName: string; PermissionsBoundary?: unknown };
      };
      expect(role.Properties.RoleName).toBe(roleName);
      // cdkd のデプロイロールは境界の付いたロールしか作れない（role-boundary.ts）
      expect(role.Properties.PermissionsBoundary).toBeDefined();
    });

    // cdkd のデプロイロールのガードレール（deploy-guardrail.ts）が、この頭のロールしか作らせない
    it(`${roleName} はガードレールが許す頭（sakekasu-dev-）で始まる`, () => {
      expect(roleName.startsWith('sakekasu-dev-')).toBe(true);
    });
  }

  it('Claude を呼ばない関数のロールは llm- の頭を持たない（ルールの前方一致に入れない）', () => {
    const roleNames = Object.values(template.findResources('AWS::IAM::Role'))
      .map((role) => (role as { Properties: { RoleName?: string } }).Properties.RoleName)
      .filter((name): name is string => typeof name === 'string' && name.includes('-llm-'));
    expect(roleNames.sort()).toEqual(LLM_FUNCTIONS.map((f) => f.roleName).sort());
  });
});

describe('ID 連携の値があるとき', () => {
  const template = apiTemplate(FEDERATION);

  for (const { functionName, modelEnv } of LLM_FUNCTIONS) {
    it(`${functionName} は Claude API を既定にし、ID 連携の値を受け取る`, () => {
      const variables = functionNamed(template, functionName).Properties.Environment.Variables;
      expect(variables).toMatchObject({
        LLM_PROVIDER: 'anthropic',
        [modelEnv]: 'claude-haiku-5-5',
        ANTHROPIC_FEDERATION_RULE_ID: FEDERATION.ruleId,
        ANTHROPIC_ORGANIZATION_ID: FEDERATION.organizationId,
        ANTHROPIC_SERVICE_ACCOUNT_ID: FEDERATION.serviceAccountId,
        ANTHROPIC_WORKSPACE_ID: FEDERATION.workspaceId,
      });
      // 控えの Bedrock は残す
      expect(variables.BEDROCK_MODEL_ID).toBe('jp.anthropic.claude-haiku-4-5-20251001-v1:0');
    });

    it(`${functionName} のロールは Anthropic 宛ての ID トークンだけを取れる`, () => {
      const fn = functionNamed(template, functionName);
      const statements = statementsOfRole(template, fn.Properties.Role['Fn::GetAtt'][0]);
      const sts = statements.filter((s) => s.Action === 'sts:GetWebIdentityToken');

      expect(sts).toHaveLength(1);
      expect(sts[0]).toMatchObject({
        Effect: 'Allow',
        Condition: {
          'ForAllValues:StringEquals': { 'sts:IdentityTokenAudience': ['https://api.anthropic.com'] },
          NumericLessThanEquals: { 'sts:DurationSeconds': 300 },
          StringEquals: { 'sts:SigningAlgorithm': 'RS256' },
        },
      });
      // Bedrock の権限はフォールバック用に残す
      expect(statements.some((s) => s.Action === 'bedrock:InvokeModel')).toBe(true);
    });
  }

  it('Claude を呼ばない関数には ID トークンの権限を付けない', () => {
    const fn = functionNamed(template, 'dev-sakekasu-presigned-url');
    const statements = statementsOfRole(template, fn.Properties.Role['Fn::GetAtt'][0]);
    expect(JSON.stringify(statements)).not.toContain('sts:');
  });
});

describe('ID 連携の値が無いとき', () => {
  const template = apiTemplate();

  for (const { functionName } of LLM_FUNCTIONS) {
    it(`${functionName} には ID 連携の環境変数を渡さない（Lambda は Bedrock だけで動く）`, () => {
      const variables = functionNamed(template, functionName).Properties.Environment.Variables;
      expect(variables.ANTHROPIC_FEDERATION_RULE_ID).toBeUndefined();
      expect(variables.LLM_PROVIDER).toBe('anthropic');
    });
  }

  it('ID トークンの権限はどのロールにも付けない', () => {
    template.resourcePropertiesCountIs(
      'AWS::IAM::Policy',
      {
        PolicyDocument: {
          Statement: Match.arrayWith([Match.objectLike({ Action: 'sts:GetWebIdentityToken' })]),
        },
      },
      0,
    );
  });
});

describe('Claude API から Bedrock へのやり直しの監視', () => {
  it('OCR とテイスティングノートのログで「[llm] fallback」を同じメトリクスに数える', () => {
    const template = apiTemplate();
    const filters = Object.values(template.findResources('AWS::Logs::MetricFilter')).filter(
      (f) =>
        (f as { Properties: { FilterPattern: string } }).Properties.FilterPattern ===
        '"[llm] fallback"',
    );
    expect(filters).toHaveLength(2);
    for (const filter of filters) {
      expect(filter).toMatchObject({
        Properties: {
          MetricTransformations: [
            { MetricNamespace: 'dev-sakekasu', MetricName: 'LlmFallbackCount', MetricValue: '1' },
          ],
        },
      });
    }
  });

  // フィルタの文言とログの文言がずれると、やり直しが起きても 0 件のままになる
  it('フィルタの文言は Lambda が出すログの文言と一致する', () => {
    const source = readFileSync(path.join(HERE, '../lambda/shared/llm.ts'), 'utf8');
    expect(source).toContain("'[llm] fallback'");
  });

  it('監視スタックにアラームを作る', () => {
    const app = new cdk.App();
    const apiStack = new ApiStack(app, 'sakekasu-dev-api', {
      envName: 'dev',
      sharedAuth: TEST_SHARED_AUTH,
      env,
    });
    const monitoring = new MonitoringStack(app, 'sakekasu-dev-monitoring', {
      envName: 'dev',
      graphqlApi: apiStack.graphqlApi,
      tables: [apiStack.purchaseTable, apiStack.drinkingTable],
      functions: [apiStack.presignedUrlFunction, apiStack.ocrAnalyzerFunction],
      ocrFunction: apiStack.ocrAnalyzerFunction,
      imageDeleteFailMetricFilter: apiStack.imageDeleteFailMetricFilter,
      llmFallbackMetricFilters: apiStack.llmFallbackMetricFilters,
      sommelierRuntimeArn:
        'arn:aws:bedrock-agentcore:ap-northeast-1:111111111111:runtime/sommelier_test-AAAAAAAAAA',
      siteUrl: 'https://example.com',
      env,
    });

    Template.fromStack(monitoring).hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'dev-sakekasu-llm-fallback',
      MetricName: 'LlmFallbackCount',
      Namespace: 'dev-sakekasu',
      Threshold: 3,
    });
  });
});

describe('Permissions Boundary の STS', () => {
  type Statement = { Sid?: string; Effect: string; Action: string | string[]; Condition?: unknown };

  const boundaryStatements = (): Statement[] => {
    const template = Template.fromStack(
      new GithubOidcStack(new cdk.App(), 'TestGithubOidc', {
        repository: 'yuuuuuuu168/sakekasu-builder',
        siteZone: 'sake.sakekasu-builder.com',
        env,
      }),
    );
    const boundary = Object.values(template.findResources('AWS::IAM::ManagedPolicy'))
      .map((p) => (p as { Properties: { ManagedPolicyName: string; PolicyDocument: { Statement: Statement[] } } }).Properties)
      .find((p) => p.ManagedPolicyName === ROLE_BOUNDARY_NAME);
    expect(boundary).toBeDefined();
    return boundary!.PolicyDocument.Statement;
  };

  it('宛先の条件キーを持たない STS の操作（AssumeRole など）はすべて拒否する', () => {
    const statement = boundaryStatements().find(
      (s) => s.Sid === 'DenySecurityTokenServiceExceptIdentityTokens',
    );
    expect(statement).toMatchObject({
      Effect: 'Deny',
      Action: 'sts:*',
      Condition: { Null: { 'sts:IdentityTokenAudience': 'true' } },
    });
  });

  it('宛先に Anthropic 以外が混ざった ID トークンは拒否する', () => {
    const statement = boundaryStatements().find((s) => s.Sid === 'DenyIdentityTokensForOtherAudiences');
    expect(statement).toMatchObject({
      Effect: 'Deny',
      Action: 'sts:GetWebIdentityToken',
      Condition: {
        'ForAnyValue:StringNotEquals': { 'sts:IdentityTokenAudience': ['https://api.anthropic.com'] },
      },
    });
  });

  it('iam / organizations / account は条件なしで拒否したまま', () => {
    const statement = boundaryStatements().find((s) => s.Sid === 'DenyIdentityAndOrganizationControl');
    expect(statement).toMatchObject({
      Effect: 'Deny',
      Action: ['iam:*', 'organizations:*', 'account:*'],
    });
    expect(statement?.Condition).toBeUndefined();
  });
});

describe('parseAnthropicFederation', () => {
  it('無ければ undefined（Bedrock だけで動く）', () => {
    expect(parseAnthropicFederation(undefined)).toBeUndefined();
    expect(parseAnthropicFederation(null)).toBeUndefined();
  });

  it('正しい形なら受け取る', () => {
    expect(parseAnthropicFederation({ ...FEDERATION })).toEqual(FEDERATION);
    const { workspaceId: _omit, ...withoutWorkspace } = FEDERATION;
    expect(parseAnthropicFederation(withoutWorkspace)).toEqual(withoutWorkspace);
  });

  // 打ち間違いのまま出すと、毎回 Claude API で失敗してから Bedrock に回り、気づきにくい
  it.each([
    [{ ...FEDERATION, ruleId: 'rule_01' }, 'ruleId'],
    [{ ...FEDERATION, organizationId: 'org-1' }, 'organizationId'],
    [{ ...FEDERATION, serviceAccountId: 'sa_01' }, 'serviceAccountId'],
    [{ ...FEDERATION, workspaceId: 'default' }, 'workspaceId'],
  ])('形が違えば synth を止める（%j）', (value, field) => {
    expect(() => parseAnthropicFederation(value)).toThrow(field);
  });

  it('オブジェクトでなければ止める', () => {
    expect(() => parseAnthropicFederation('fdrl_01')).toThrow('anthropicFederation');
  });
});
