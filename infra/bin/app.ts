#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack.js';
import { ApiStack } from '../lib/api-stack.js';
import { MonitoringStack } from '../lib/monitoring-stack.js';
import { HealthGlobalStack } from '../lib/health-global-stack.js';
import { BillingNotifierStack } from '../lib/billing-notifier-stack.js';
import { GithubOidcStack } from '../lib/github-oidc-stack.js';
import { DevOpsAgentStack } from '../lib/devops-agent-stack.js';

const app = new cdk.App();

// GitHub Actions からの CDK デプロイ用 OIDC 連携（Issue #94）。
// Actions 自身にこのスタックを触らせると、ロールの更新ミスで自分を
// 締め出す恐れがあるため、billing と同様にフラグ付きの手動デプロイ専用。
// 使用例: npx cdk deploy sakekasu-github-oidc -c github-oidc=true
if (app.node.tryGetContext('github-oidc')) {
  new GithubOidcStack(app, 'sakekasu-github-oidc', {
    repository: 'yuuuuuuu168/sakekasu-builder',
    // アプリ本体と同じ sakekasu-builder アカウント
    env: { account: '232791540685', region: 'ap-northeast-1' },
  });
}

// 利用料金の Slack 通知（Issue #92）は、アカウント別の内訳を見られる
// Organization の管理アカウントにしか置けないため、通常のデプロイ先
// （sakekasu-builder）とは分けて -c billing=true のときだけ合成する。
// 環境（dev/staging/prod）にも紐づかない単一のスタック。
// 使用例: npx cdk deploy sakekasu-billing-notifier -c billing=true
if (app.node.tryGetContext('billing')) {
  new BillingNotifierStack(app, 'sakekasu-billing-notifier', {
    // 個別に内訳を出すアカウント。組織全体の合計は常に出るため、
    // 親アカウント単体の表示は不要という判断（Issue #92 のレビュー）
    targetAccounts: [
      { id: '232791540685', label: 'sakekasu-builder（アプリ本体）' },
    ],
    // Organization の管理アカウント。デプロイ時はこのアカウントの認証情報が必要
    env: { account: '<管理アカウント ID>', region: 'ap-northeast-1' },
  });
} else {
  buildApplicationStacks(app);
}

/** アプリ本体のスタック群（sakekasu-builder アカウントへデプロイするもの） */
function buildApplicationStacks(app: cdk.App): void {
  // 環境名をコンテキストパラメータから取得（デフォルト: dev）
  const envName = app.node.tryGetContext('env') as string | undefined;

  const validEnvs = ['dev', 'staging', 'prod'] as const;
  type EnvName = (typeof validEnvs)[number];

  if (!envName || !validEnvs.includes(envName as EnvName)) {
    throw new Error(
      `環境名が無効です: "${envName}"。有効な値: ${validEnvs.join(', ')}。` +
      ' 使用例: cdk deploy --all -c env=dev'
    );
  }

  const env: EnvName = envName as EnvName;
  const prefix = `sakekasu-${env}`;

  // デプロイ先の AWS 環境（リージョン固定）
  const cdkEnv: cdk.Environment = {
    region: 'ap-northeast-1',
    account: process.env.CDK_DEFAULT_ACCOUNT,
  };

  // AuthStack: Cognito UserPool + Client
  const authStack = new AuthStack(app, `${prefix}-auth`, {
    envName: env,
    env: cdkEnv,
  });

  // ApiStack: AppSync + DynamoDB（AuthStack の UserPool を参照）
  const apiStack = new ApiStack(app, `${prefix}-api`, {
    envName: env,
    userPool: authStack.userPool,
    env: cdkEnv,
  });

  // MonitoringStack: アラームと外形監視、Slack 通知
  // ソムリエ Runtime は agentcore CLI 側で管理しているため、ARN は文脈から渡す
  const sommelierRuntimeArn =
    (app.node.tryGetContext('sommelierRuntimeArn') as string | undefined) ??
    'arn:aws:bedrock-agentcore:ap-northeast-1:232791540685:runtime/sommelier_sommelier-Cn5eM865GE';

  const siteUrl =
    (app.node.tryGetContext('siteUrl') as string | undefined) ?? 'https://sakekasu-builder.com';

  const monitoringStack = new MonitoringStack(app, `${prefix}-monitoring`, {
    envName: env,
    graphqlApi: apiStack.graphqlApi,
    tables: [apiStack.purchaseTable, apiStack.drinkingTable],
    functions: [apiStack.presignedUrlFunction, apiStack.ocrAnalyzerFunction],
    ocrFunction: apiStack.ocrAnalyzerFunction,
    imageDeleteFailMetricFilter: apiStack.imageDeleteFailMetricFilter,
    signupNotifyFailMetricFilter: authStack.signupNotifyFailMetricFilter,
    sommelierRuntimeArn,
    siteUrl,
    userPoolId: authStack.userPool.userPoolId,
    canaryUserPoolClientId: authStack.canaryUserPoolClient.userPoolClientId,
    env: cdkEnv,
  });

  // グローバルサービスの AWS Health イベントは us-east-1 にしか届かないため、
  // そこで受けて監視リージョンのイベントバスへ転送する
  const healthGlobalStack = new HealthGlobalStack(app, `${prefix}-health-global`, {
    envName: env,
    targetRegion: cdkEnv.region!,
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  });

  // DevOps Agent 連携（Issue #67）。Agent Space はプライマリアカウントの
  // コンソールで作るため、その ARN がコンテキストに入るまでは合成しない。
  // コンソール作業が済んだら cdk.json の context に agentSpaceArn を書けば、
  // 以降は他のスタックと同じく `cdk deploy --all` で更新される
  const agentSpaceArn = app.node.tryGetContext('agentSpaceArn') as string | undefined;

  if (agentSpaceArn) {
    // Agent Space を置いたプライマリアカウント。信頼条件に使うため、
    // ARN から読み取って書き間違いを防ぐ
    const monitoringAccountId = agentSpaceArn.split(':')[4];
    if (!/^\d{12}$/.test(monitoringAccountId ?? '')) {
      throw new Error(
        `agentSpaceArn が Agent Space の ARN として不正です: "${agentSpaceArn}"。` +
        ' 例: arn:aws:aidevops:ap-northeast-1:<管理アカウント ID>:agentspace/xxxxxxxx'
      );
    }

    const devopsAgentStack = new DevOpsAgentStack(app, `${prefix}-devops-agent`, {
      envName: env,
      monitoringAccountId,
      agentSpaceArn,
      alertTopic: monitoringStack.alertTopic,
      env: cdkEnv,
    });
    devopsAgentStack.addDependency(monitoringStack);
  }

  // スタック間の依存関係を明示
  apiStack.addDependency(authStack);
  monitoringStack.addDependency(apiStack);
  // 転送先のバスでルールが待ち構えている状態にしてから転送側を作る
  healthGlobalStack.addDependency(monitoringStack);
}
