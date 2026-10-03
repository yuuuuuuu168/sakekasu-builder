// Feature: cdk-backend-auth, Property 5: 設定ファイル生成の構造保証

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  buildAmplifyOutputs,
  type RawStackOutputs,
} from '../scripts/generate-outputs.js';

/**
 * **Validates: Requirements 5.2, 5.3, 5.4**
 *
 * Property 5: 設定ファイル生成の構造保証
 *
 * 有効な UserPool ID、UserPool Client ID、GraphQL API URL、AWS リージョンの
 * 組み合わせに対して、generate-outputs スクリプトが生成する JSON は
 * auth.user_pool_id、auth.user_pool_client_id、auth.aws_region、
 * data.url、data.aws_region、data.default_authorization_type フィールドを
 * すべて含み、入力値と一致すること。
 */
describe('Property 5: 設定ファイル生成の構造保証', () => {
  const regionArb = fc.constantFrom('us-east-1', 'us-west-2', 'ap-northeast-1');

  const rawStackOutputsArb: fc.Arbitrary<RawStackOutputs> = fc.record({
    sharedAuth: fc.record({
      domain: fc.stringMatching(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/),
      userPoolId: regionArb.chain((region) =>
        fc.stringMatching(/^[A-Za-z0-9]{9}$/).map((id) => `${region}_${id}`),
      ),
      clientId: fc.stringMatching(/^[a-z0-9]{1,64}$/),
    }),
    graphqlApiUrl: fc.string({ minLength: 1, maxLength: 256 }),
    apiRegion: regionArb,
  });

  it('buildAmplifyOutputs は入力値と一致する auth/data フィールドを含む JSON を返す', () => {
    fc.assert(
      fc.property(rawStackOutputsArb, (raw) => {
        const result = buildAmplifyOutputs(raw);

        // auth セクション (Requirements 5.2)
        expect(result.auth.user_pool_id).toBe(raw.sharedAuth.userPoolId);
        expect(result.auth.user_pool_client_id).toBe(raw.sharedAuth.clientId);
        // リージョンはユーザープール ID の先頭から取る
        expect(raw.sharedAuth.userPoolId.startsWith(`${result.auth.aws_region}_`)).toBe(true);

        // 共通ログイン（マネージドログイン）の接続先
        expect(result.auth.oauth.domain).toBe(raw.sharedAuth.domain);
        expect(result.auth.oauth.scopes).toEqual(['openid', 'email', 'profile']);
        expect(result.auth.oauth.response_type).toBe('code');

        // data セクション (Requirements 5.3)
        expect(result.data.url).toBe(raw.graphqlApiUrl);
        expect(result.data.aws_region).toBe(raw.apiRegion);
        expect(result.data.default_authorization_type).toBe(
          'AMAZON_COGNITO_USER_POOLS',
        );

        // version (Requirements 5.4)
        expect(result.version).toBe('1.3');
      }),
      { numRuns: 100 },
    );
  });

  it('出力 JSON はすべての必須フィールドを含む', () => {
    fc.assert(
      fc.property(rawStackOutputsArb, (raw) => {
        const result = buildAmplifyOutputs(raw);

        // auth セクションの必須フィールド
        expect(result).toHaveProperty('auth.user_pool_id');
        expect(result).toHaveProperty('auth.user_pool_client_id');
        expect(result).toHaveProperty('auth.aws_region');
        expect(result).toHaveProperty('auth.oauth.domain');

        // data セクションの必須フィールド
        expect(result).toHaveProperty('data.url');
        expect(result).toHaveProperty('data.aws_region');
        expect(result).toHaveProperty('data.default_authorization_type');

        // version フィールド
        expect(result).toHaveProperty('version');
      }),
      { numRuns: 100 },
    );
  });
});
