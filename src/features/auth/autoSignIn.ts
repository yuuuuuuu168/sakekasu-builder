/**
 * 未サインインで開いたときに、ボタンを押させずにマネージドログインへ送る仕組み。
 *
 * 送るのはタブごとに一度だけ。送る前に sessionStorage へ印を置き、戻ってきても
 * まだ未サインイン（ログイン画面で戻った・取り消した、`?error=` 付きで戻った等）
 * なら、印を見て自動では送らず、ボタンのある画面を出す。行ったり来たりを
 * 繰り返さないため。サインインできたら印を消す。
 *
 * sessionStorage なので新しいタブではまた一度だけ自動で送る。sessionStorage が
 * 使えない（プライベートモードの一部など）ときは、一度だけを守れないので自動では送らない。
 */

/** 印のキー。値は意味を持たず、あるかどうかだけを見る */
export const AUTO_SIGN_IN_MARK_KEY = 'sakekasu-builder:auto-sign-in';

type MarkStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function sessionStore(): MarkStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    // ストレージを塞いだブラウザでは、触った時点で例外になる
    return null;
  }
}

/** このタブで、もう自動で送ったか */
export function hasAutoSignInMark(storage: MarkStorage | null = sessionStore()): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(AUTO_SIGN_IN_MARK_KEY) !== null;
  } catch {
    // 読めないなら送ったものとみなす（自動で送らない側に倒す）
    return true;
  }
}

/** 自動で送る直前に印を置く。置けなかったら false で、そのときは送らない */
export function markAutoSignIn(storage: MarkStorage | null = sessionStore()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(AUTO_SIGN_IN_MARK_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/** サインインできたら印を消す。次にサインアウトしてから開いたときは、また一度だけ送る */
export function clearAutoSignInMark(storage: MarkStorage | null = sessionStore()): void {
  try {
    storage?.removeItem(AUTO_SIGN_IN_MARK_KEY);
  } catch {
    // 消せなくても、次に自動で送らないだけで困らない
  }
}

/**
 * 読み込みを終えて未サインインだったときに、自動で送ってよいか。
 *
 * 戻りの最中（`code` / `error` 付き）は送らない。`code` は Amplify が交換中で、
 * `error` は利用者が取り消したか拒まれたので、文言を出してボタンで選ばせる。
 */
export function canAutoSignIn(
  landing: { oauthCallback: boolean },
  storage: MarkStorage | null = sessionStore(),
): boolean {
  return !landing.oauthCallback && !hasAutoSignInMark(storage);
}
