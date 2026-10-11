/**
 * 共通ポータル（https://sakekasu-builder.com/apps）から来たときの目印 `?sso=1` の扱い。
 *
 * ポータルから来る利用者は、直前に共通ログイン（マネージドログイン）で
 * サインインしたばかりなので、マネージドログインへ送ればコード付きで黙って
 * 戻ってくる。目印があって未サインインのときだけ、サインインのボタンを
 * 押させずに自動で送る（AuthPage）。
 *
 * 目印は読んだらすぐ URL から消す。マネージドログインの戻り先は素の `/`
 * なので、戻ってきた URL には目印が無く、戻りで失敗しても行ったり来たりを
 * 繰り返さない。
 */

/** ポータルが付けてくるクエリ名 */
export const SSO_HINT_PARAM = 'sso';

/** マネージドログインからの戻りに付くクエリ。これがあれば戻りの最中とみなす */
const OAUTH_CALLBACK_PARAMS = ['code', 'state', 'error', 'error_description'];

export interface SsoHint {
  /** `sso=1` が付いていた */
  present: boolean;
  /** マネージドログインからの戻り（code / error 付き）の最中 */
  oauthCallback: boolean;
  /**
   * `sso` を取り除いた URL（パス + クエリ + ハッシュ）。`sso` が無ければ null で、
   * URL を書き換える必要は無い
   */
  cleanedUrl: string | null;
}

/**
 * URL から目印を読み、目印を除いた URL を作る。window に触らない純粋関数。
 *
 * `sso` は値によらずすべて取り除く（`sso=0` なども残しておく意味が無い）。
 * 目印とみなすのは値が `1` のときだけ。パス・他のクエリ・ハッシュはそのまま残す。
 */
export function parseSsoHint(href: string): SsoHint {
  const url = new URL(href);
  const params = url.searchParams;

  const present = params.getAll(SSO_HINT_PARAM).includes('1');
  const oauthCallback = OAUTH_CALLBACK_PARAMS.some((name) => params.has(name));

  if (!params.has(SSO_HINT_PARAM)) {
    return { present, oauthCallback, cleanedUrl: null };
  }

  params.delete(SSO_HINT_PARAM);
  const search = params.toString();
  const cleanedUrl = `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
  return { present, oauthCallback, cleanedUrl };
}

/**
 * 目印を読んで URL から消し、自動でサインインへ送ってよいかを返す。
 *
 * 送ってよいのは目印があり、かつマネージドログインからの戻りの最中でない
 * ときだけ。戻りの最中は Amplify がトークン交換をしているので、ここから
 * もう一度送ると交換を潰してしまう。
 */
export function consumeSsoHint(
  location: Pick<Location, 'href'> = window.location,
  history: Pick<History, 'replaceState' | 'state'> = window.history,
): boolean {
  const hint = parseSsoHint(location.href);
  if (hint.cleanedUrl !== null) {
    // 履歴を増やさずに書き換える。戻るボタンで目印付きの URL に戻らないようにする
    history.replaceState(history.state, '', hint.cleanedUrl);
  }
  return hint.present && !hint.oauthCallback;
}
