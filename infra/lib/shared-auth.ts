/**
 * 共通ログイン（sakekasu-integrated_environment の identity スタック）の接続先。
 *
 * 4 アプリ（reinvent / builder / kakeibo / learning）でユーザープールを1つ共有し、
 * ログイン画面はマネージドログイン（`auth.sakekasu-builder.com`）が受け持つ。
 * このアプリはそこに登録された builder 用のアプリクライアントだけを使う。
 *
 * 値は `cdk.json` の context `sharedAuth` に `{ domain, userPoolId, clientId }` で置く。
 * スタック間の参照ではつながない（別リポジトリのスタックなので、そもそも参照できない）。
 * コードに直接書かないのは、プールやクライアントを作り直したときに直す場所を
 * cdk.json の1か所に絞るため。
 */
export interface SharedAuth {
  /** マネージドログインのドメイン（`https://` を付けない） */
  domain: string;
  /** 共通ユーザープールの ID（`ap-northeast-1_xxxx`） */
  userPoolId: string;
  /** builder 用アプリクライアントの ID */
  clientId: string;
}

const DOMAIN = /^[a-z0-9.-]+$/;
const USER_POOL_ID = /^[a-z]{2}-[a-z]+-\d_[A-Za-z0-9]+$/;
const CLIENT_ID = /^[a-z0-9]+$/;

/**
 * context の値を検査して返す。形が崩れていたら合成の時点で落とす。
 *
 * 必須にしている（sakekasu-reinvent のように「無ければ自前のプール」に戻さない）。
 * 画面は共通ログインのマネージドログイン前提に作り替えてあり、旧プール用の
 * サインイン画面はもう無いため、インフラだけ旧プールへ戻しても動かない。
 * 切り戻しはこの変更を含む PR ごと revert する。
 */
export function parseSharedAuth(value: unknown): SharedAuth {
  if (value === undefined || value === null || value === '') {
    throw new Error(
      'cdk.json の context に sharedAuth（{ domain, userPoolId, clientId }）が要る。' +
        ' 値は sakekasu-integrated_environment の identity スタックの出力',
    );
  }
  const { domain, userPoolId, clientId } = value as Record<string, unknown>;
  const ok =
    typeof domain === 'string' &&
    DOMAIN.test(domain) &&
    typeof userPoolId === 'string' &&
    USER_POOL_ID.test(userPoolId) &&
    typeof clientId === 'string' &&
    CLIENT_ID.test(clientId);
  if (!ok) {
    throw new Error('sharedAuth は { domain, userPoolId, clientId } で渡す（domain に https:// は付けない）');
  }
  return { domain, userPoolId, clientId };
}

/** ユーザープール ID の先頭がリージョン（`ap-northeast-1_xxxx` → `ap-northeast-1`） */
export function sharedAuthRegion(auth: SharedAuth): string {
  return auth.userPoolId.split('_')[0];
}

/** トークンの発行者（iss）。JWT の検証先 */
export function sharedAuthIssuer(auth: SharedAuth): string {
  return `https://cognito-idp.${sharedAuthRegion(auth)}.amazonaws.com/${auth.userPoolId}`;
}
