import { describe, it, expect } from 'vitest';
import { Template } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack.js';
import { ApiStack } from '../lib/api-stack.js';
import { MonitoringStack } from '../lib/monitoring-stack.js';
import { GithubOidcStack } from '../lib/github-oidc-stack.js';
import { BillingNotifierStack } from '../lib/billing-notifier-stack.js';
import { ROLE_BOUNDARY_NAME } from '../lib/role-boundary.js';
import { TEST_SHARED_AUTH } from './shared-auth-fixture.js';

/**
 * アプリのロールに Permissions Boundary が付いていることを見る（Issue #150）。
 *
 * cdkd のデプロイロールは、境界の付いたロールしか作り替えられない条件に
 * なっている。境界が外れたスタックがあると、そのスタックのデプロイが
 * AccessDenied で止まる。逆に境界が外れたまま cdkd 側の条件も外れると、
 * デプロイロールからの権限昇格が復活する。
 */

const ACCOUNT = '111111111111';
const env = { account: ACCOUNT, region: 'ap-northeast-1' };

function buildApplicationStacks(): Array<{ name: string; template: Template }> {
  const app = new cdk.App();
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
    functions: [apiStack.presignedUrlFunction, apiStack.ocrAnalyzerFunction],
    ocrFunction: apiStack.ocrAnalyzerFunction,
    imageDeleteFailMetricFilter: apiStack.imageDeleteFailMetricFilter,
    signupNotifyFailMetricFilter: authStack.signupNotifyFailMetricFilter,
    sommelierRuntimeArn:
      'arn:aws:bedrock-agentcore:ap-northeast-1:111111111111:runtime/sommelier_test-AAAAAAAAAA',
    siteUrl: 'https://example.com',
    userPoolId: authStack.userPool.userPoolId,
    canaryUserPoolClientId: authStack.canaryUserPoolClient.userPoolClientId,
    env,
  });

  return [
    { name: 'auth', template: Template.fromStack(authStack) },
    { name: 'api', template: Template.fromStack(apiStack) },
    { name: 'monitoring', template: Template.fromStack(monitoringStack) },
  ];
}

function rolesOf(template: Template): Array<Record<string, unknown>> {
  return Object.values(template.findResources('AWS::IAM::Role')).map(
    (r) => (r as { Properties: Record<string, unknown> }).Properties,
  );
}

describe('Permissions Boundary', () => {
  const stacks = buildApplicationStacks();

  for (const { name, template } of stacks) {
    it(`${name} スタックのロールはすべて境界の内側にある`, () => {
      const roles = rolesOf(template);
      expect(roles.length).toBeGreaterThan(0);

      for (const role of roles) {
        expect(role.PermissionsBoundary, `${name}: ${role.RoleName ?? '(自動生成名)'}`).toBeDefined();
      }
    });
  }

  it('境界は iam と sts を拒否する（権限昇格の連鎖を切る）', () => {
    const template = Template.fromStack(
      new GithubOidcStack(new cdk.App(), 'TestGithubOidc', {
        repository: 'yuuuuuuu168/sakekasu-builder',
        env,
      }),
    );

    const policies = Object.values(template.findResources('AWS::IAM::ManagedPolicy')).map(
      (p) => (p as { Properties: { ManagedPolicyName: string; PolicyDocument: { Statement: Array<{ Effect: string; Action: string | string[] }> } } }).Properties,
    );
    const boundary = policies.find((p) => p.ManagedPolicyName === ROLE_BOUNDARY_NAME);
    expect(boundary, '境界ポリシーが無い').toBeDefined();

    const denied = boundary!.PolicyDocument.Statement.filter((s) => s.Effect === 'Deny').flatMap(
      (s) => (Array.isArray(s.Action) ? s.Action : [s.Action]),
    );
    expect(denied).toContain('iam:*');
    expect(denied).toContain('sts:*');
  });

  it('OIDC 連携のロールには境界を付けない（付けるとアプリのロールを作れなくなる）', () => {
    const template = Template.fromStack(
      new GithubOidcStack(new cdk.App(), 'TestGithubOidc', {
        repository: 'yuuuuuuu168/sakekasu-builder',
        env,
      }),
    );

    for (const role of rolesOf(template)) {
      expect(role.PermissionsBoundary, String(role.RoleName ?? '(自動生成名)')).toBeUndefined();
    }
  });

  it('管理アカウント側の billing スタックは対象外', () => {
    const template = Template.fromStack(
      new BillingNotifierStack(new cdk.App(), 'sakekasu-billing-notifier', {
        targetAccounts: [{ id: ACCOUNT, label: 'test' }],
        env: { account: '222222222222', region: 'ap-northeast-1' },
      }),
    );

    for (const role of rolesOf(template)) {
      expect(role.PermissionsBoundary).toBeUndefined();
    }
  });
});
