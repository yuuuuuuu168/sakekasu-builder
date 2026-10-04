import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import { cdkdDeployStatements, cdkdDiffStatements } from './cdkd-policies.js';
import { deployGuardrailStatements } from './deploy-guardrail.js';
import { createRoleBoundary } from './role-boundary.js';

export interface GithubOidcStackProps extends cdk.StackProps {
  /** 信頼する GitHub リポジトリ（owner/repo 形式） */
  repository: string;
  /**
   * フロントの配信に使うサブドメインのゾーン（cdk.json の siteZone）。
   * cdkd のデプロイロールが DNS レコードを書き換えられる範囲をここに絞る
   */
  siteZone: string;
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
 *   読み取り権限しか持たないため、PR 上で差分は取れてもリソース変更はできない
 *
 * これに加えて、cdkd（CDK Direct）移行用のロールを1本足している（Issue #150）。
 * cdkd は CloudFormation を通さないため bootstrap のロールが使えず、強い権限を
 * 持つロールが別に要る。ランナー自身にその権限を持たせず、deploy ロールから
 * AssumeRole して使う形にすることで、強い権限を1箇所に閉じ込める。
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
    // ap-northeast-1 と us-east-1 の両方を許可する（us-east-1 は以前 health-global
    // スタックに使っていた。いまは無いが、境界を狭める理由も無いので残す）
    const bootstrapRoleArns = `arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`;

    const deployRole = new iam.Role(this, 'DeployRole', {
      roleName: 'sakekasu-github-actions-deploy',
      // IAM の description は ASCII + Latin-1 のみ（日本語を入れるとデプロイが 400 で落ちる）
      description: 'CDK deploy from GitHub Actions (main branch only)',
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

    // アプリのロールに付ける Permissions Boundary（Issue #150）。
    // cdkd のデプロイロールが作るロールはこの天井を超えられない。
    // 詳細は lib/role-boundary.ts
    const roleBoundary = createRoleBoundary(this, 'RoleBoundary');

    // cdkd のデプロイ先ロール（Issue #150）。
    //
    // 信頼するのは deploy ロールだけ。GitHub の OIDC からは直接引き受けられない
    // ため、main への push という条件は deploy ロール側の信頼ポリシーが担保する。
    //
    // ロール名を固定しているのは、ワークフローの CDKD_ROLE_ARN と
    // 移行手順（docs/cdkd-migration.md）から名前で参照するため。
    const cdkdDeployRole = new iam.Role(this, 'CdkdDeployRole', {
      roleName: 'sakekasu-cdkd-deploy',
      description: 'cdkd deploy target (assumed by the GitHub Actions deploy role)',
      assumedBy: new iam.ArnPrincipal(deployRole.roleArn),
      // 既定の1時間。cdkd のデプロイは数分で終わる想定で、長く持たせる理由がない
      maxSessionDuration: cdk.Duration.hours(1),
    });
    for (const statement of cdkdDeployStatements(this.account, props.siteZone)) {
      cdkdDeployRole.addToPolicy(statement);
    }

    // 同じアカウントにいる他のアプリのリソースに触れないためのガードレール（deploy-guardrail.ts）。
    // インラインのポリシーはロールあたり合計 10,240 文字までで、上の許可だけで 7.8KB あるため、
    // 管理ポリシーに分けて付ける。名前は builder の接頭辞（sakekasu-dev-* など）の外にあるので、
    // cdkd 用ロールからは中身を書き換えられない（DenyRolesOutsideApp）
    new iam.ManagedPolicy(this, 'CdkdDeployGuardrail', {
      managedPolicyName: 'sakekasu-cdkd-deploy-guardrail',
      description: 'Deny-only guardrail that keeps cdkd deploys of sakekasu-builder inside the builder app',
      roles: [cdkdDeployRole],
      statements: deployGuardrailStatements({
        account: this.account,
        app: 'builder',
        resourceNamePrefixes: ['sakekasu-dev-', 'sakekasu-staging-', 'sakekasu-prod-'],
        protectedRoleNames: [
          'sakekasu-cdkd-deploy',
          'sakekasu-github-actions-deploy',
          'sakekasu-github-actions-diff',
          'sakekasu-github-actions-site',
        ],
      }),
    });

    // deploy ロールから cdkd ロールへ入れるようにする。
    // cdk-hnb659fds-* への AssumeRole は、移行が終わって CDK CLI を使わなく
    // なるまで残す（移行途中は cdk deploy と cdkd deploy が混在する）
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [cdkdDeployRole.roleArn],
      }),
    );

    const diffRole = new iam.Role(this, 'DiffRole', {
      roleName: 'sakekasu-github-actions-diff',
      description: 'Read-only cdk diff from GitHub Actions (pull_request)',
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          [`${githubDomain}:aud`]: 'sts.amazonaws.com',
          [`${githubDomain}:sub`]: `repo:${props.repository}:pull_request`,
        },
      }),
    });

    // cdkd diff 用の読み取り権限（Issue #150）。
    //
    // cdkd は lookup ロールに入らず、自分の認証情報で各リソースを読む。
    // cdk-diff.yml が cdkd diff に切り替わり、CDK bootstrap の
    // cdk-hnb659fds-lookup-role-* への AssumeRole は使われなくなったので外した。
    // 書き込みは入れないので、PR からリソースを変更できない構成は変わらない
    for (const statement of cdkdDiffStatements(this.account)) {
      diffRole.addToPolicy(statement);
    }

    // フロントの配信物を置くロール（docs/sake-subdomain.md、deploy-site.yml）。
    //
    // deploy ロールとは分ける。deploy ロールは cdkd のロールへ入れるので、
    // フロントのビルド（infra とは別の依存一式）を同じロールの下で走らせると、
    // 乗っ取られた依存から cdkd の権限まで届きうる。こちらは配信バケットの
    // オブジェクトを読み書きできるだけで、CloudFront にも IAM にも触れない。
    //
    // 認証情報を入れるのはビルドの後（deploy-site.yml）なので、ビルド中の
    // スクリプトからはこのロールにも届かない。分けてあるのは多層の守り
    const siteRole = new iam.Role(this, 'SiteDeployRole', {
      roleName: 'sakekasu-github-actions-site',
      description: 'Upload the frontend build to the site bucket (main branch only)',
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          [`${githubDomain}:aud`]: 'sts.amazonaws.com',
          [`${githubDomain}:sub`]: `repo:${props.repository}:ref:refs/heads/main`,
        },
      }),
      maxSessionDuration: cdk.Duration.hours(1),
    });
    // バケット名は site-stack.ts の siteBucketName と同じ形。環境接頭辞は * で拾う
    const siteBucketArn = `arn:aws:s3:::*-sakekasu-site-${this.account}`;
    siteRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ListSiteBucket',
        actions: ['s3:ListBucket'],
        resources: [siteBucketArn],
      }),
    );
    siteRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'WriteSiteObjects',
        actions: ['s3:PutObject', 's3:DeleteObject'],
        resources: [`${siteBucketArn}/*`],
      }),
    );

    new cdk.CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
    new cdk.CfnOutput(this, 'SiteDeployRoleArn', { value: siteRole.roleArn });
    new cdk.CfnOutput(this, 'DiffRoleArn', { value: diffRole.roleArn });
    new cdk.CfnOutput(this, 'CdkdDeployRoleArn', { value: cdkdDeployRole.roleArn });
    new cdk.CfnOutput(this, 'RoleBoundaryArn', { value: roleBoundary.managedPolicyArn });
  }
}
