import { describe, it, expect, beforeAll } from 'vitest';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { GithubOidcStack } from '../lib/github-oidc-stack.js';

const REPOSITORY = 'yuuuuuuu168/sakekasu-builder';

function synth(): Template {
  const app = new cdk.App();
  const stack = new GithubOidcStack(app, 'TestGithubOidc', {
    repository: REPOSITORY,
    env: { account: '111111111111', region: 'ap-northeast-1' },
  });
  return Template.fromStack(stack);
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

  it('deploy ロールの実権限は bootstrap ロール群への AssumeRole だけ', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('DeployRole') })]),
      PolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Resource: 'arn:aws:iam::111111111111:role/cdk-hnb659fds-*',
          },
        ],
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
    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('DiffRole') })]),
      PolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Resource: 'arn:aws:iam::111111111111:role/cdk-hnb659fds-lookup-role-*',
          },
        ],
      },
    });
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
