#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack.js';
import { ApiStack } from '../lib/api-stack.js';
import { MonitoringStack } from '../lib/monitoring-stack.js';

const app = new cdk.App();

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
  sommelierRuntimeArn,
  siteUrl,
  userPoolId: authStack.userPool.userPoolId,
  userPoolClientId: authStack.userPoolClient.userPoolClientId,
  env: cdkEnv,
});

// スタック間の依存関係を明示
apiStack.addDependency(authStack);
monitoringStack.addDependency(apiStack);
