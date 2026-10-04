#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack.js';
import { MonitoringStack } from '../lib/monitoring-stack.js';
import { BillingNotifierStack } from '../lib/billing-notifier-stack.js';
import { GithubOidcStack } from '../lib/github-oidc-stack.js';
import { DevOpsAgentStack } from '../lib/devops-agent-stack.js';
import { SiteDnsStack } from '../lib/site-dns-stack.js';
import { SiteStack } from '../lib/site-stack.js';
import { parseSharedAuth, sharedAuthRegion, type SharedAuth } from '../lib/shared-auth.js';
import { readFileSync } from 'node:fs';

const app = new cdk.App();

// GitHub Actions からの CDK デプロイ用 OIDC 連携（Issue #94）。
// Actions 自身にこのスタックを触らせると、ロールの更新ミスで自分を
// 締め出す恐れがあるため、billing と同様にフラグ付きの手動デプロイ専用。
// 使用例: npx cdk deploy sakekasu-github-oidc -c github-oidc=true
if (app.node.tryGetContext('github-oidc')) {
  const siteZone = app.node.tryGetContext('siteZone') as string | undefined;
  if (!siteZone) {
    throw new Error('cdk.json の context に siteZone（例: sake.sakekasu-builder.com）が要る');
  }
  new GithubOidcStack(app, 'sakekasu-github-oidc', {
    repository: 'yuuuuuuu168/sakekasu-builder',
    siteZone,
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

  // 共通ログイン（sakekasu-integrated_environment の identity スタック）。
  // 4 アプリで共有するユーザープールと、builder 用のアプリクライアント。
  // 値は cdk.json の context に置き、スタック間の参照ではつながない
  const sharedAuth = parseSharedAuth(app.node.tryGetContext('sharedAuth'));

  // 旧ユーザープール（sakekasu-dev-auth）はアプリから外した。cdkd deploy --all は
  // 合成したスタックしか見ないので、外しただけでは消えない。手で cdkd state destroy
  // する（docs/shared-login.md の「旧ユーザープールを外す」）

  // ApiStack: AppSync + DynamoDB（認証は共通ログインのユーザープール）
  const apiStack = new ApiStack(app, `${prefix}-api`, {
    envName: env,
    sharedAuth,
    env: cdkEnv,
  });

  // MonitoringStack: アラームと外形監視、Slack 通知
  // ソムリエ Runtime は agentcore CLI 側で管理しているため、ARN は文脈から渡す
  const sommelierRuntimeArn =
    (app.node.tryGetContext('sommelierRuntimeArn') as string | undefined) ??
    'arn:aws:bedrock-agentcore:ap-northeast-1:232791540685:runtime/sommelier_sommelier-Cn5eM865GE';

  const siteUrl =
    (app.node.tryGetContext('siteUrl') as string | undefined) ?? 'https://sake.sakekasu-builder.com';

  const monitoringStack = new MonitoringStack(app, `${prefix}-monitoring`, {
    envName: env,
    graphqlApi: apiStack.graphqlApi,
    tables: [apiStack.purchaseTable, apiStack.drinkingTable],
    functions: [
      apiStack.presignedUrlFunction,
      apiStack.ocrAnalyzerFunction,
      apiStack.tastingNoteFunction,
    ],
    ocrFunction: apiStack.ocrAnalyzerFunction,
    imageDeleteFailMetricFilter: apiStack.imageDeleteFailMetricFilter,
    sommelierRuntimeArn,
    siteUrl,
    env: cdkEnv,
  });

  // AWS Health の通知はここに置かない。アカウント全体の話なので、共通基盤
  // （sakekasu-integrated_environment の sakekasu-integrated-monitoring /
  // sakekasu-integrated-health-global）だけが持つ。両方に置くと同じ通知が 2 通届く。
  // 以前ここにあった us-east-1 の sakekasu-dev-health-global は、アプリから外しても
  // cdkd deploy --all では消えないため、手で cdkd state destroy する
  // （docs/cdkd-migration.md の「health-global を外した」）

  // DevOps Agent 連携（Issue #67）。Agent Space はプライマリアカウントの
  // コンソールで作るため、その ARN がコンテキストに入るまでは合成しない。
  // コンソール作業が済んだら cdk.json の context に agentSpaceArn を書けば、
  // 以降は他のスタックと同じく `cdk deploy --all` で更新される
  const agentSpaceArn = app.node.tryGetContext('agentSpaceArn') as string | undefined;

  if (agentSpaceArn) {
    // ARN は丸ごと形を見る。アカウント ID だけを見ていると
    // `.../agentspace/*` のようなワイルドカード付きでも通ってしまい、
    // 信頼条件は完全一致（ArnEquals）なので実際の Agent Space と永久に
    // 一致しない。デプロイは成功するのに調査だけが始まらない状態になる
    const AGENT_SPACE_ARN =
      /^arn:aws:aidevops:[a-z0-9-]+:\d{12}:agentspace\/[A-Za-z0-9_-]+$/;
    if (!AGENT_SPACE_ARN.test(agentSpaceArn)) {
      throw new Error(
        `agentSpaceArn が Agent Space の ARN として不正です: "${agentSpaceArn}"。` +
        ' 例: arn:aws:aidevops:ap-northeast-1:<運用アカウント ID>:agentspace/xxxxxxxx'
      );
    }

    // Agent Space を置いたプライマリアカウント。信頼条件に使うため、
    // ARN から読み取って書き間違いを防ぐ
    const monitoringAccountId = agentSpaceArn.split(':')[4];

    const devopsAgentStack = new DevOpsAgentStack(app, `${prefix}-devops-agent`, {
      envName: env,
      monitoringAccountId,
      agentSpaceArn,
      alertTopic: monitoringStack.alertTopic,
      env: cdkEnv,
    });
    devopsAgentStack.addDependency(monitoringStack);
  }

  // スタック間の依存関係を明示（api → monitoring）
  monitoringStack.addDependency(apiStack);

  buildSiteStacks(app, prefix, env, cdkEnv.account, sharedAuth);
}

/**
 * フロントの配信（docs/sake-subdomain.md）。2026-10-04 に Amplify Hosting から移した。
 *
 * 段階を分けて合成する。ゾーンを親から委任してもらい、その後で証明書をコンソールで作る
 * （cdkd は ACM の証明書を作れない。理由は site-stack.ts の冒頭）。
 *
 *   siteZone だけ:              ゾーン（sakekasu-<env>-site-dns）だけを作る
 *   + siteHostedZoneId と
 *     siteCertificateArn:       委任と証明書が済んだ後。配信（sakekasu-<env>-site）も作る
 */
function buildSiteStacks(
  app: cdk.App,
  prefix: string,
  envName: string,
  account: string | undefined,
  sharedAuth: SharedAuth,
): void {
  const siteZone = app.node.tryGetContext('siteZone') as string | undefined;
  if (!siteZone) return;

  new SiteDnsStack(app, `${prefix}-site-dns`, {
    zoneName: siteZone,
    env: { account, region: 'ap-northeast-1' },
  });

  const siteHostedZoneId = app.node.tryGetContext('siteHostedZoneId') as string | undefined;
  const siteCertificateArn = app.node.tryGetContext('siteCertificateArn') as string | undefined;
  if (!siteHostedZoneId || !siteCertificateArn) return;

  // CSP に入れる AppSync の URL は、画面が実際に読む設定ファイルから取る。
  // api スタックの出力を参照でつなぐと us-east-1 から ap-northeast-1 への
  // スタック間参照になるため使わない
  const outputs = JSON.parse(
    readFileSync(new URL('../../amplify_outputs.json', import.meta.url), 'utf8'),
  ) as { data: { url: string } };

  new SiteStack(app, `${prefix}-site`, {
    envName,
    domainName: siteZone,
    hostedZoneId: siteHostedZoneId,
    zoneName: siteZone,
    certificateArn: siteCertificateArn,
    graphqlUrl: outputs.data.url,
    // 署名付き URL は Lambda の S3Client（ap-northeast-1、仮想ホスト形式）が作る
    imageBucketDomain: `${envName}-sakekasu-images.s3.ap-northeast-1.amazonaws.com`,
    cognitoRegion: sharedAuthRegion(sharedAuth),
    authDomain: sharedAuth.domain,
    sommelierRegion: 'ap-northeast-1',
    // CloudFront の証明書は us-east-1 にしか置けない
    env: { account, region: 'us-east-1' },
  });
}
