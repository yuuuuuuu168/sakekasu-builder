/**
 * 開いた URL の読み取り。共通ポータルの目印 `?sso=1` を消し、マネージドログインからの
 * 戻りの最中かどうかを見る。
 *
 * 以前は `?sso=1` が付いているときだけ自動でマネージドログインへ送っていたが、
 * いまは未サインインなら目印によらず一度だけ自動で送る（autoSignIn.ts）。
 * 目印はもう判断に使わないが、ポータルが付けてくるので今までどおり URL からは消す。
 *
 * 戻りの最中（`code` / `error` 付き）は自動で送らない。`code` のときは Amplify が
 * トークン交換をしているので、ここから送り直すと交換を潰す。`error` のときは
 * 画面に失敗の文言を出して、利用者にボタンで選ばせる。
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
  /** マネージドログインが `error` を付けて戻してきた（取り消し・拒否など） */
  oauthError: boolean;
  /**
   * `sso` を取り除いた URL（パス + クエリ + ハッシュ）。`sso` が無ければ null で、
   * URL を書き換える必要は無い
   */
  cleanedUrl: string | null;
}

/** 読み込みの最初に URL から読んだこと。AuthProvider が自動で送るかを決めるのに使う */
export interface LandingUrl {
  /** マネージドログインからの戻り（code / error 付き）の最中 */
  oauthCallback: boolean;
  /** マネージドログインが `error` を付けて戻してきた */
  oauthError: boolean;
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
  const oauthError = params.has('error');

  if (!params.has(SSO_HINT_PARAM)) {
    return { present, oauthCallback, oauthError, cleanedUrl: null };
  }

  params.delete(SSO_HINT_PARAM);
  const search = params.toString();
  const cleanedUrl = `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
  return { present, oauthCallback, oauthError, cleanedUrl };
}

/**
 * URL を読んで目印を消し、戻りの最中かどうかを返す。
 *
 * `error` は消さない。Amplify は戻りの処理で URL を読み直し、`error` を見て
 * 失敗のイベントを流すので、先に消すとそちらの判断が変わってしまう。
 */
export function consumeSsoHint(
  location: Pick<Location, 'href'> = window.location,
  history: Pick<History, 'replaceState' | 'state'> = window.history,
): LandingUrl {
  const hint = parseSsoHint(location.href);
  if (hint.cleanedUrl !== null) {
    // 履歴を増やさずに書き換える。戻るボタンで目印付きの URL に戻らないようにする
    history.replaceState(history.state, '', hint.cleanedUrl);
  }
  return { oauthCallback: hint.oauthCallback, oauthError: hint.oauthError };
}
