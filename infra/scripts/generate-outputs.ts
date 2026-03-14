#!/usr/bin/env node
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * amplify_outputs.json 互換の出力構造
 */
export interface AmplifyOutputs {
  auth: {
    user_pool_id: string;
    user_pool_client_id: string;
    aws_region: string;
  };
  data: {
    url: string;
    aws_region: string;
    default_authorization_type: 'AMAZON_COGNITO_USER_POOLS';
  };
  version: '1.3';
}

/**
 * CloudFormation 出力から取得した生の値
 */
export interface RawStackOutputs {
  userPoolId: string;
  userPoolClientId: string;
  authRegion: string;
  graphqlApiUrl: string;
  apiRegion: string;
}

/**
 * 生の CloudFormation 出力値から amplify_outputs.json 互換の構造を組み立てる純粋関数。
 * テスト容易性のために分離。
 */
export function buildAmplifyOutputs(raw: RawStackOutputs): AmplifyOutputs {
  return {
    auth: {
      user_pool_id: raw.userPoolId,
      user_pool_client_id: raw.userPoolClientId,
      aws_region: raw.authRegion,
    },
    data: {
      url: raw.graphqlApiUrl,
      aws_region: raw.apiRegion,
      default_authorization_type: 'AMAZON_COGNITO_USER_POOLS',
    },
    version: '1.3',
  };
}

/**
 * 指定スタックの CloudFormation 出力をマップとして取得する
 */
async function getStackOutputs(
  client: CloudFormationClient,
  stackName: string,
): Promise<Record<string, string>> {
  const command = new DescribeStacksCommand({ StackName: stackName });
  const response = await client.send(command);

  const stack = response.Stacks?.[0];
  if (!stack) {
    throw new Error(`スタック "${stackName}" が見つかりません`);
  }

  const outputs: Record<string, string> = {};
  for (const output of stack.Outputs ?? []) {
    if (output.OutputKey && output.OutputValue) {
      outputs[output.OutputKey] = output.OutputValue;
    }
  }
  return outputs;
}

/**
 * メイン処理: CloudFormation 出力を取得し amplify_outputs.json を生成する
 */
async function main(): Promise<void> {
  const env = process.argv[2] ?? 'dev';
  const authStackName = `sakekasu-${env}-auth`;
  const apiStackName = `sakekasu-${env}-api`;

  console.log(`環境: ${env}`);
  console.log(`Auth スタック: ${authStackName}`);
  console.log(`API スタック: ${apiStackName}`);

  const client = new CloudFormationClient({});

  const [authOutputs, apiOutputs] = await Promise.all([
    getStackOutputs(client, authStackName),
    getStackOutputs(client, apiStackName),
  ]);

  const raw: RawStackOutputs = {
    userPoolId: authOutputs['UserPoolId'] ?? '',
    userPoolClientId: authOutputs['UserPoolClientId'] ?? '',
    authRegion: authOutputs['AuthRegion'] ?? '',
    graphqlApiUrl: apiOutputs['GraphqlApiUrl'] ?? '',
    apiRegion: apiOutputs['ApiRegion'] ?? '',
  };

  // 必須値の検証
  const missing: string[] = [];
  if (!raw.userPoolId) missing.push('UserPoolId');
  if (!raw.userPoolClientId) missing.push('UserPoolClientId');
  if (!raw.authRegion) missing.push('AuthRegion');
  if (!raw.graphqlApiUrl) missing.push('GraphqlApiUrl');
  if (!raw.apiRegion) missing.push('ApiRegion');

  if (missing.length > 0) {
    throw new Error(
      `以下の CloudFormation 出力が見つかりません: ${missing.join(', ')}`,
    );
  }

  const amplifyOutputs = buildAmplifyOutputs(raw);

  // プロジェクトルート（infra/ の親ディレクトリ）に出力
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outputPath = resolve(__dirname, '../../amplify_outputs.json');

  writeFileSync(outputPath, JSON.stringify(amplifyOutputs, null, 2) + '\n');
  console.log(`✅ ${outputPath} を生成しました`);
}

main().catch((err) => {
  console.error('❌ エラー:', err instanceof Error ? err.message : err);
  process.exit(1);
});
