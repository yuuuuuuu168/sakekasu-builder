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
 * 本番でサインアウトしたあとの戻り先。4 アプリ共通の入口（ポータル）のトップ。
 *
 * サインアウトはこのアプリだけでなくマネージドログインのセッションも切るので、
 * このアプリのログイン画面ではなく、共通の入口へ帰す。Cognito は登録済みの
 * logout_uri にしか戻さないため、この URL は sakekasu-integrated_environment の
 * infra/cdk.json（apps の builder の logoutUrls）に登録してある。末尾の / まで完全一致。
 */
export const PORTAL_SIGN_OUT_URL = 'https://sakekasu-builder.com/';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

/** オリジン + `/`。共通ログインに登録した戻り先は末尾の `/` まで完全一致で比べられる */
function rootOf(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/`;
}

/**
 * サインアウト後の戻り先。手元の開発（localhost）はこれまでどおり自分の `/` へ、
 * それ以外（本番）は共通の入口へ帰す。
 *
 * Amplify v6 は、signOut に戻り先を渡さないと redirectSignOut のうち
 * いま開いているオリジンと同じものしか選ばず、別オリジンだけだと
 * invalidOriginException で落ちる（@aws-amplify/auth の
 * providers/cognito/utils/oauth/getRedirectUrl.ts）。そのため設定と
 * signOut の `oauth.redirectUrl` の両方にこの値を使う。
 */
export function signOutRedirectUrl(origin: string): string {
  const { hostname } = new URL(origin);
  return LOCAL_HOSTNAMES.has(hostname) ? rootOf(origin) : PORTAL_SIGN_OUT_URL;
}

/**
 * 設定ファイルと、開いているオリジンから Amplify の設定を組み立てる。
 *
 * ログインはマネージドログインへのリダイレクト（Authorization code + PKCE）。
 * 戻り先はいま開いているオリジンの `/` にする。共通ログイン側に登録してあるのは
 * `https://sake.sakekasu-builder.com/` と `http://localhost:5173/` の2つで、
 * 末尾の `/` まで完全一致でないと Cognito が redirect_mismatch で断る。
 * サインアウト後の戻り先は {@link signOutRedirectUrl}（本番は共通の入口）。
 *
 * 純粋関数にしてあるのはテストのため（window に触らない）。
 */
export function buildAmplifyConfig(outputs: AppOutputs, origin: string): ResourcesConfig {
  const redirect = rootOf(origin);
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
            redirectSignOut: [signOutRedirectUrl(origin)],
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
