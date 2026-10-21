/**
 * 複数のファイルで同じ形に組み立てていたロール名と ARN。
 *
 * 名前を変えるとロールやポリシーが作り直しになる（docs/aws-infra-rules.md の「cdkd の落とし穴」）。
 * ここの値は実物と一致していることが前提なので、整理のつもりで書き換えない。
 *
 * deploy-guardrail.ts はテンプレートから同期するファイル（managed）なので、ここを参照させない。
 */

/** アプリ本体の環境。bin/app.ts の -c env と、cdkd のガードレールが通すロール名の接頭辞に使う */
export const APP_ENVS = ['dev', 'staging', 'prod'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/**
 * 環境ごとの名前の接頭辞（`sakekasu-<env>`）。スタック名と、アプリのロール名の頭になる。
 * cdkd のデプロイロールはこの頭のロールしか作れない（deploy-guardrail.ts の DenyRolesOutsideApp）
 */
export function appNamePrefix(envName: string): string {
  return `sakekasu-${envName}`;
}

/** GitHub Actions の OIDC トークンの発行元。プロバイダーの URL と ARN に入る */
export const GITHUB_OIDC_DOMAIN = 'token.actions.githubusercontent.com';

/**
 * GitHub Actions が引き受けるロールの名前（github-oidc-stack.ts が作る）。
 * ワークフローとドキュメントからも名前で参照している
 */
export const GITHUB_ACTIONS_DEPLOY_ROLE_NAME = 'sakekasu-github-actions-deploy';
export const CDKD_DEPLOY_ROLE_NAME = 'sakekasu-cdkd-deploy';
export const GITHUB_ACTIONS_DIFF_ROLE_NAME = 'sakekasu-github-actions-diff';
export const GITHUB_ACTIONS_SITE_ROLE_NAME = 'sakekasu-github-actions-site';

/**
 * cdkd のデプロイロールから書き換えさせないロール。cdkd 自身と、それを呼ぶ側のロール。
 * どれもアプリのロールと同じ `sakekasu-*` に入るので、明示的に抜く
 */
export const GITHUB_ACTIONS_ROLE_NAMES = [
  CDKD_DEPLOY_ROLE_NAME,
  GITHUB_ACTIONS_DEPLOY_ROLE_NAME,
  GITHUB_ACTIONS_DIFF_ROLE_NAME,
  GITHUB_ACTIONS_SITE_ROLE_NAME,
];

/** IAM ロールの ARN。roleName には `sakekasu-*` のようなワイルドカードやパスも渡せる */
export function iamRoleArn(account: string, roleName: string): string {
  return `arn:aws:iam::${account}:role/${roleName}`;
}

/**
 * アプリのロール全体（`sakekasu-*`）。スタック名が接頭辞に付くので、
 * cdkd が作るロールはこの範囲に閉じる
 */
export function appRolesArn(account: string): string {
  return iamRoleArn(account, 'sakekasu-*');
}

/** cdkd の状態バケット（全アプリで共用。キーはスタック名ごとに分かれる） */
export function cdkdStateBucketArn(account: string): string {
  return `arn:aws:s3:::cdkd-state-${account}`;
}

/** cdkd の資産置き場（リージョンごとにある。全アプリで共用） */
export function cdkdAssetsBucketsArn(account: string): string {
  return `arn:aws:s3:::cdkd-assets-${account}-*`;
}

/** 画像バケット（`<env>-sakekasu-images`）。環境接頭辞は * で拾う */
export const IMAGE_BUCKETS_ARN = 'arn:aws:s3:::*-sakekasu-images';

/** 配信バケット（site-stack.ts の siteBucketName と同じ形）。環境接頭辞は * で拾う */
export function siteBucketsArn(account: string): string {
  return `arn:aws:s3:::*-sakekasu-site-${account}`;
}
