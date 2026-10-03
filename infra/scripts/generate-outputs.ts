#!/usr/bin/env node
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSharedAuth, sharedAuthRegion, type SharedAuth } from '../lib/shared-auth.js';

/**
 * 共通ログインで要求する OAuth スコープ。
 *
 * builder のアプリクライアントに許されているのはこの3つだけ。
 * `aws.cognito.signin.user.admin` は無いので、fetchUserAttributes や
 * TOTP の登録など、そのスコープが要る Amplify の API は使えない
 */
export const SHARED_AUTH_SCOPES = ['openid', 'email', 'profile'] as const;

/**
 * amplify_outputs.json 互換の出力構造。
 *
 * `auth.oauth` は共通ログイン（マネージドログイン）の接続先。戻り先の URL は
 * 開いているオリジンで決まるので、ここには入れず画面側で組み立てる
 * （src/features/auth/amplifyConfig.ts）
 */
export interface AmplifyOutputs {
  auth: {
    user_pool_id: string;
    user_pool_client_id: string;
    aws_region: string;
    oauth: {
      domain: string;
      scopes: string[];
      response_type: 'code';
    };
  };
  data: {
    url: string;
    aws_region: string;
    default_authorization_type: 'AMAZON_COGNITO_USER_POOLS';
  };
  version: '1.3';
}

/**
 * 設定ファイルの材料。認証は cdk.json の sharedAuth、API は api スタックの出力から取る
 */
export interface RawStackOutputs {
  sharedAuth: SharedAuth;
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
      user_pool_id: raw.sharedAuth.userPoolId,
      user_pool_client_id: raw.sharedAuth.clientId,
      aws_region: sharedAuthRegion(raw.sharedAuth),
      oauth: {
        domain: raw.sharedAuth.domain,
        scopes: [...SHARED_AUTH_SCOPES],
        response_type: 'code',
      },
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
 * メイン処理: 共通ログインの値（cdk.json）と API スタックの出力から
 * amplify_outputs.json を生成する。
 *
 * 認証は旧 auth スタックの出力を読まない。ログインは共通ログインへ移り、
 * 旧プールは切り戻し用に残してあるだけなので
 */
async function main(): Promise<void> {
  const env = process.argv[2] ?? 'dev';
  const apiStackName = `sakekasu-${env}-api`;

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const cdkJson = JSON.parse(
    readFileSync(resolve(__dirname, '../cdk.json'), 'utf8'),
  ) as { context?: Record<string, unknown> };
  const sharedAuth = parseSharedAuth(cdkJson.context?.sharedAuth);

  console.log(`環境: ${env}`);
  console.log(`共通ログイン: ${sharedAuth.domain}`);
  console.log(`API スタック: ${apiStackName}`);

  const client = new CloudFormationClient({});
  const apiOutputs = await getStackOutputs(client, apiStackName);

  const raw: RawStackOutputs = {
    sharedAuth,
    graphqlApiUrl: apiOutputs['GraphqlApiUrl'] ?? '',
    apiRegion: apiOutputs['ApiRegion'] ?? '',
  };

  // 必須値の検証
  const missing: string[] = [];
  if (!raw.graphqlApiUrl) missing.push('GraphqlApiUrl');
  if (!raw.apiRegion) missing.push('ApiRegion');

  if (missing.length > 0) {
    throw new Error(
      `以下の CloudFormation 出力が見つかりません: ${missing.join(', ')}`,
    );
  }

  const amplifyOutputs = buildAmplifyOutputs(raw);

  // プロジェクトルート（infra/ の親ディレクトリ）に出力
  const outputPath = resolve(__dirname, '../../amplify_outputs.json');

  writeFileSync(outputPath, JSON.stringify(amplifyOutputs, null, 2) + '\n');
  console.log(`✅ ${outputPath} を生成しました`);
}

// このファイルを直接実行したときだけ main() を走らせる。
//
// 無条件に呼ぶと、テストが純粋関数を import しただけで CloudFormation を叩き、
// amplify_outputs.json を書き換えてしまう。失敗した場合は process.exit(1) が
// テストランナーごと落とす。実際 CI ではこれで test ジョブが落ちた（ローカルは
// cdk.out と認証が揃っていたため main() が成功してしまい、気づけなかった）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('❌ エラー:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
