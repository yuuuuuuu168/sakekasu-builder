import type { ResourcesConfig } from 'aws-amplify';

/**
 * amplify_outputs.json の形（infra/scripts/generate-outputs.ts が書く）。
 *
 * `auth` は共通ログイン（sakekasu-integrated_environment）のユーザープールと、
 * そこに登録された builder 用のアプリクライアント。`auth.oauth` は
 * マネージドログイン（ログイン画面・MFA を受け持つ）の接続先。
 */
export interface AppOutputs {
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
  version: string;
}

/**
 * 設定ファイルと、開いているオリジンから Amplify の設定を組み立てる。
 *
 * ログインはマネージドログインへのリダイレクト（Authorization code + PKCE）。
 * 戻り先はいま開いているオリジンの `/` にする。共通ログイン側に登録してあるのは
 * `https://sake.sakekasu-builder.com/`・`https://sakekasu-builder.com/`・
 * `https://www.sakekasu-builder.com/`・`http://localhost:5173/` の4つで
 * （apex と www は sake. への移行が済んだら外す。docs/sake-subdomain.md）、
 * 末尾の `/` まで完全一致でないと
 * Cognito が redirect_mismatch で断る。Amplify Hosting のプレビュー URL などは
 * 登録していないので、そこからはログインできない。
 *
 * 純粋関数にしてあるのはテストのため（window に触らない）。
 */
export function buildAmplifyConfig(outputs: AppOutputs, origin: string): ResourcesConfig {
  const redirect = `${origin.replace(/\/+$/, '')}/`;
  return {
    Auth: {
      Cognito: {
        userPoolId: outputs.auth.user_pool_id,
        userPoolClientId: outputs.auth.user_pool_client_id,
        loginWith: {
          oauth: {
            domain: outputs.auth.oauth.domain,
            scopes: outputs.auth.oauth.scopes,
            redirectSignIn: [redirect],
            redirectSignOut: [redirect],
            responseType: outputs.auth.oauth.response_type,
          },
        },
      },
    },
    API: {
      GraphQL: {
        endpoint: outputs.data.url,
        region: outputs.data.aws_region,
        defaultAuthMode: 'userPool',
      },
    },
  };
}
