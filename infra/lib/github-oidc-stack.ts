import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

export interface GithubOidcStackProps extends cdk.StackProps {
  /** 信頼する GitHub リポジトリ（owner/repo 形式） */
  repository: string;
}

/**
 * GitHub Actions から CDK デプロイするための OIDC 連携スタック（Issue #94）。
 *
 * アクセスキーをリポジトリに置かず、GitHub の OIDC トークンで一時認証する。
 * ロールは2本に分ける:
 *
 * - deploy ロール: main ブランチの push からのみ引き受け可能。
 *   実権限は持たず、CDK bootstrap が作った cdk-hnb659fds-* ロール群への
 *   sts:AssumeRole だけを許可する（実際の作成・変更権限は bootstrap 側に委譲）
 * - diff ロール: pull_request イベントからのみ引き受け可能。
 *   読み取り専用の lookup ロールにしか入れないため、PR 上で cdk diff は
 *   できてもリソース変更はできない
 *
 * このスタック自体は Actions のデプロイ対象（--all）に含めない。
 * 自分自身のロールを自動更新して締め出す事故を避けるため、billing と同じく
 * コンテキストフラグ付きの手動デプロイとする。
 * 使用例: npx cdk deploy sakekasu-github-oidc -c github-oidc=true
 */
export class GithubOidcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    const githubDomain = 'token.actions.githubusercontent.com';

    const provider = new iam.OpenIdConnectProvider(this, 'GithubOidcProvider', {
      url: `https://${githubDomain}`,
      clientIds: ['sts.amazonaws.com'],
    });

    // CDK bootstrap のロール名にはリージョンが含まれるため、ワイルドカードで
    // ap-northeast-1 と us-east-1（health-global スタック用）の両方を許可する
    const bootstrapRoleArns = `arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`;
    const lookupRoleArns = `arn:aws:iam::${this.account}:role/cdk-hnb659fds-lookup-role-*`;

    const deployRole = new iam.Role(this, 'DeployRole', {
      roleName: 'sakekasu-github-actions-deploy',
      description: 'GitHub Actions（mainブランチ）からのCDKデプロイ用',
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          [`${githubDomain}:aud`]: 'sts.amazonaws.com',
          [`${githubDomain}:sub`]: `repo:${props.repository}:ref:refs/heads/main`,
        },
      }),
    });
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [bootstrapRoleArns],
      }),
    );

    const diffRole = new iam.Role(this, 'DiffRole', {
      roleName: 'sakekasu-github-actions-diff',
      description: 'GitHub Actions（pull_request）でのcdk diff用（読み取り専用）',
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          [`${githubDomain}:aud`]: 'sts.amazonaws.com',
          [`${githubDomain}:sub`]: `repo:${props.repository}:pull_request`,
        },
      }),
    });
    diffRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [lookupRoleArns],
      }),
    );

    new cdk.CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
    new cdk.CfnOutput(this, 'DiffRoleArn', { value: diffRole.roleArn });
  }
}
