import { describe, it, expect } from 'vitest';
import { buildAmplifyConfig, type AppOutputs } from '../amplifyConfig';
import outputs from '../../../../amplify_outputs.json';

const OUTPUTS: AppOutputs = {
  auth: {
    user_pool_id: 'ap-northeast-1_SharedTest',
    user_pool_client_id: 'sharedtestclientid',
    aws_region: 'ap-northeast-1',
    oauth: {
      domain: 'auth.example.com',
      scopes: ['openid', 'email', 'profile'],
      response_type: 'code',
    },
  },
  data: {
    url: 'https://example.appsync-api.ap-northeast-1.amazonaws.com/graphql',
    aws_region: 'ap-northeast-1',
    default_authorization_type: 'AMAZON_COGNITO_USER_POOLS',
  },
  version: '1.3',
};

describe('buildAmplifyConfig', () => {
  it('マネージドログインへ Authorization code で送る設定を組み立てる', () => {
    const config = buildAmplifyConfig(OUTPUTS, 'https://sakekasu-builder.com');
    expect(config.Auth?.Cognito).toMatchObject({
      userPoolId: 'ap-northeast-1_SharedTest',
      userPoolClientId: 'sharedtestclientid',
      loginWith: {
        oauth: {
          domain: 'auth.example.com',
          scopes: ['openid', 'email', 'profile'],
          responseType: 'code',
        },
      },
    });
  });

  // 共通ログイン側に登録した戻り先は末尾の / まで完全一致。ずれると redirect_mismatch
  it.each([
    ['https://sakekasu-builder.com', 'https://sakekasu-builder.com/'],
    ['https://www.sakekasu-builder.com', 'https://www.sakekasu-builder.com/'],
    ['http://localhost:5173', 'http://localhost:5173/'],
    ['http://localhost:5173/', 'http://localhost:5173/'],
  ])('戻り先はオリジン + / にする（%s）', (origin, expected) => {
    const oauth = buildAmplifyConfig(OUTPUTS, origin).Auth?.Cognito.loginWith?.oauth;
    expect(oauth?.redirectSignIn).toEqual([expected]);
    expect(oauth?.redirectSignOut).toEqual([expected]);
  });

  it('AppSync は共通ログインのトークンで呼ぶ', () => {
    expect(buildAmplifyConfig(OUTPUTS, 'http://localhost:5173').API?.GraphQL).toEqual({
      endpoint: OUTPUTS.data.url,
      region: 'ap-northeast-1',
      defaultAuthMode: 'userPool',
    });
  });

  // コミットしてある設定ファイルが、共通ログインの形になっていること。
  // aws.cognito.signin.user.admin はクライアントに許されていないので要求しない
  it('amplify_outputs.json は共通ログインの OAuth 設定を持つ', () => {
    const committed = outputs as AppOutputs;
    expect(committed.auth.oauth.domain).toMatch(/^[a-z0-9.-]+$/);
    expect(committed.auth.oauth.scopes).toEqual(['openid', 'email', 'profile']);
    expect(committed.auth.oauth.response_type).toBe('code');
  });
});
