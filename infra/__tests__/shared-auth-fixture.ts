import type { SharedAuth } from '../lib/shared-auth.js';

/**
 * テスト用の共通ログインの接続先。実在の値は使わない（cdk.json の値とは別物）。
 * ApiStack の合成に要るだけで、AWS へは出ない
 */
export const TEST_SHARED_AUTH: SharedAuth = {
  domain: 'auth.example.com',
  userPoolId: 'ap-northeast-1_SharedTest',
  clientId: 'sharedtestclientid',
};
