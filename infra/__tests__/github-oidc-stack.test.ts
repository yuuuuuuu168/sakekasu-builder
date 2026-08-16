import { describe, it, expect, beforeAll } from 'vitest';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { GithubOidcStack } from '../lib/github-oidc-stack.js';

const REPOSITORY = 'yuuuuuuu168/sakekasu-builder';
const ACCOUNT = '111111111111';

function synth(): Template {
  const app = new cdk.App();
  const stack = new GithubOidcStack(app, 'TestGithubOidc', {
    repository: REPOSITORY,
    env: { account: ACCOUNT, region: 'ap-northeast-1' },
  });
  return Template.fromStack(stack);
}

interface Statement {
  Sid?: string;
  Effect: 'Allow' | 'Deny';
  Action: string | string[];
  Resource: string | string[];
}

function toArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

/** 指定したロールに付いている AWS::IAM::Policy の全ステートメントを集める */
function statementsFor(template: Template, roleLogicalId: RegExp): Statement[] {
  const policies = template.findResources('AWS::IAM::Policy');
  return Object.values(policies)
    .map((p) => (p as { Properties: { Roles?: unknown[]; PolicyDocument: { Statement: Statement[] } } }).Properties)
    .filter((props) =>
      (props.Roles ?? []).some(
        (r) => typeof r === 'object' && r !== null && 'Ref' in r &&
          roleLogicalId.test((r as { Ref: string }).Ref),
      ),
    )
    .flatMap((props) => props.PolicyDocument.Statement);
}

/**
 * そのアクションが許可されているか。ポリシーはワイルドカード（`appsync:*`）を
 * 使うため、文字列の一致ではなくパターンとして評価する
 */
function allows(statements: Statement[], action: string): boolean {
  return statements.some(
    (s) =>
      s.Effect === 'Allow' &&
      toArray(s.Action).some((a) => new RegExp(`^${a.replace(/\*/g, '.*')}$`, 'i').test(action)),
  );
}

describe('GithubOidcStack', () => {
  let template: Template;

  beforeAll(() => {
    template = synth();
  });

  it('deploy ロールは main ブランチの push からしか引き受けられない', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'sakekasu-github-actions-deploy',
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: Match.objectLike({
                'token.actions.githubusercontent.com:sub':
                  `repo:${REPOSITORY}:ref:refs/heads/main`,
              }),
            },
          }),
        ]),
      },
    });
  });

  it('deploy ロールの実権限は AssumeRole だけ（自分では何も作れない）', () => {
    // CdkdDeployRole も論理 ID に DeployRole を含むため、明示的に除く
    const statements = statementsFor(template, /^DeployRole/);

    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement.Effect).toBe('Allow');
      expect(toArray(statement.Action)).toEqual(['sts:AssumeRole']);
    }

    const targets = statements.flatMap((s) => toArray(s.Resource));
    // 移行が終わるまでは CDK CLI も使うため、bootstrap ロールへの経路は残す
    expect(targets).toContain(`arn:aws:iam::${ACCOUNT}:role/cdk-hnb659fds-*`);
  });

  it('deploy ロールは cdkd のデプロイロールへ入れる', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('^DeployRole') })]),
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Resource: {
              'Fn::GetAtt': Match.arrayWith([Match.stringLikeRegexp('^CdkdDeployRole')]),
            },
          }),
        ]),
      },
    });
  });

  it('diff ロールは pull_request からのみで、読み取り専用の lookup ロールにしか入れない', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'sakekasu-github-actions-diff',
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: {
              StringEquals: Match.objectLike({
                'token.actions.githubusercontent.com:sub': `repo:${REPOSITORY}:pull_request`,
              }),
            },
          }),
        ]),
      },
    });
    const statements = statementsFor(template, /^DiffRole/);
    const targets = statements.flatMap((s) => toArray(s.Resource));
    expect(targets).toContain(`arn:aws:iam::${ACCOUNT}:role/cdk-hnb659fds-lookup-role-*`);
  });

  it('diff ロールには書き込み権限が一切ない', () => {
    const statements = statementsFor(template, /^DiffRole/);
    expect(statements.length).toBeGreaterThan(0);

    for (const action of [
      'lambda:UpdateFunctionCode',
      'lambda:CreateFunction',
      'dynamodb:PutItem',
      'dynamodb:UpdateTable',
      's3:PutObject',
      's3:DeleteObject',
      'iam:PutRolePolicy',
      'iam:CreateRole',
      'cognito-idp:UpdateUserPool',
      'cloudformation:CreateResource',
      'cloudformation:UpdateResource',
      'cloudformation:DeleteStack',
    ]) {
      expect(allows(statements, action), `${action} が許可されている`).toBe(false);
    }
  });

  it('diff ロールは読み取りでも利用者のデータには届かない', () => {
    const statements = statementsFor(template, /^DiffRole/);
    expect(statements.length).toBeGreaterThan(0);

    // ログには画像キー経由で Cognito の sub が入りうる（lib/log-retention.ts）
    for (const action of [
      'logs:GetLogEvents',
      'logs:FilterLogEvents',
      'dynamodb:GetItem',
      'dynamodb:Query',
      'dynamodb:Scan',
      'cognito-idp:ListUsers',
      'cognito-idp:AdminGetUser',
    ]) {
      expect(allows(statements, action), `${action} が許可されている`).toBe(false);
    }

    // s3:GetObject は cdkd の state バケットにだけ許す。画像バケットには許さない
    const objectReaders = statements.filter(
      (s) => s.Effect === 'Allow' && toArray(s.Action).includes('s3:GetObject'),
    );
    expect(objectReaders.length).toBeGreaterThan(0);
    for (const statement of objectReaders) {
      for (const resource of toArray(statement.Resource)) {
        expect(resource).toContain(`cdkd-state-${ACCOUNT}`);
      }
    }
  });

  it('cdkd のデプロイロールは deploy ロールからしか引き受けられない', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'sakekasu-cdkd-deploy',
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: 'sts:AssumeRole',
            Principal: {
              AWS: { 'Fn::GetAtt': Match.arrayWith([Match.stringLikeRegexp('^DeployRole')]) },
            },
          }),
        ],
      },
    });
  });

  it('cdkd のデプロイロールは OIDC 連携のロール自身を書き換えられない', () => {
    const statements = statementsFor(template, /^CdkdDeployRole/);
    const deny = statements.find((s) => s.Effect === 'Deny');

    expect(deny, 'Deny ステートメントが無い').toBeDefined();
    expect(toArray(deny!.Action)).toContain('iam:*');
    expect(toArray(deny!.Resource)).toEqual(
      expect.arrayContaining([
        `arn:aws:iam::${ACCOUNT}:role/sakekasu-cdkd-deploy`,
        `arn:aws:iam::${ACCOUNT}:role/sakekasu-github-actions-deploy`,
        `arn:aws:iam::${ACCOUNT}:role/sakekasu-github-actions-diff`,
      ]),
    );
  });

  it('cdkd のデプロイロールは利用者のデータを読めない', () => {
    const statements = statementsFor(template, /^CdkdDeployRole/);
    expect(statements.length).toBeGreaterThan(0);

    for (const action of [
      'dynamodb:GetItem',
      'dynamodb:Query',
      'dynamodb:Scan',
      'cognito-idp:ListUsers',
      'cognito-idp:AdminGetUser',
    ]) {
      expect(allows(statements, action), `${action} が許可されている`).toBe(false);
    }

    // 画像バケットはバケットの設定だけ。オブジェクトには触らせない
    const objectWriters = statements.filter(
      (s) =>
        s.Effect === 'Allow' &&
        toArray(s.Action).some((a) => /^s3:(GetObject|PutObject|DeleteObject|\*)$/.test(a)),
    );
    for (const statement of objectWriters) {
      for (const resource of toArray(statement.Resource)) {
        expect(resource).toMatch(/cdkd-(state|assets)-/);
      }
    }
  });

  it('cdkd のデプロイロールは AdministratorAccess を貼っていない', () => {
    const roles = template.findResources('AWS::IAM::Role', {
      Properties: { RoleName: 'sakekasu-cdkd-deploy' },
    });
    const managed = Object.values(roles).flatMap(
      (r) => (r as { Properties: { ManagedPolicyArns?: unknown[] } }).Properties.ManagedPolicyArns ?? [],
    );
    expect(managed).toEqual([]);
  });

  it('OIDC プロバイダーは GitHub Actions のトークン発行元を指す', () => {
    // OpenIdConnectProvider はカスタムリソースとして合成される
    const providers = template.findResources('Custom::AWSCDKOpenIdConnectProvider');
    const urls = Object.values(providers).map(
      (p) => (p as { Properties: { Url: string } }).Properties.Url,
    );
    expect(urls).toContain('https://token.actions.githubusercontent.com');
  });
});
