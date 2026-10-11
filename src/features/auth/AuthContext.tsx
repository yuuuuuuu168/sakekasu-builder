import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { Hub } from 'aws-amplify/utils';
import {
  signInWithRedirect,
  signOut as amplifySignOut,
  getCurrentUser,
} from 'aws-amplify/auth';
import {
  clearMessages,
  clearSessionId,
} from '@/features/sommelier/lib/chatStorage';
import { clearFilterState } from '@/features/records/lib/filterStorage';
import { clearDownloadUrlCache } from '@/features/image/lib/downloadUrlCache';
import { consumeSsoHint, type LandingUrl } from './ssoHint';
import { canAutoSignIn, clearAutoSignInMark, markAutoSignIn } from './autoSignIn';
import { signOutRedirectUrl } from './amplifyConfig';

/**
 * 認証済みユーザーの型。
 *
 * 持つのは sub（userId）だけ。端末に残すデータのキーと、サインアウト時の
 * 後始末に使う。メールアドレスは画面に出さない方針なので取りにいかない
 * （共通ログインのクライアントは aws.cognito.signin.user.admin スコープを
 * 持たず、fetchUserAttributes もそもそも使えない）
 */
export interface AuthUser {
  userId: string;
}

/** 認証コンテキストの値 */
export interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** マネージドログインから戻ってきたが、サインインに失敗したときの文言 */
  error: string | null;
  /** 共通ログインのマネージドログインへ移る（ページごと遷移する） */
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * 読み込みを終えた時点で未サインインで、このタブではまだ自動で送っていない。
   * AuthPage はこのとき見本の画面を見せずに「移動中」の表示で始める
   */
  autoSignIn: boolean;
  /**
   * 自動サインインを始めてよいかを一度だけ答える（2回目以降は常に false）。
   * 印は autoSignIn を立てる時点で置いてある（autoSignIn.ts）。true を返したら、
   * 呼び手がボタンと同じ signIn を呼ぶ
   */
  takeAutoSignIn: () => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** 現在の認証ユーザー情報を取得するヘルパー（トークンのクレームから読むだけで通信しない） */
async function fetchAuthUser(): Promise<AuthUser> {
  const currentUser = await getCurrentUser();
  return { userId: currentUser.userId };
}

/** リダイレクトの失敗を画面に出す文言にする。原因の詳細はコンソールに残す */
const REDIRECT_FAILURE_MESSAGE =
  'サインインを完了できませんでした。もう一度お試しください';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 開いた URL から読んだこと。null はまだ読んでいない。StrictMode で effect が
  // 2回走っても URL は1回目で書き換わるので、読んだ結果を ref に持っておく
  const landingRef = useRef<LandingUrl | null>(null);
  // 自動で送ってよいと決めたか。決めるのは最初の読み込みのときだけで、
  // サインアウトやリフレッシュの失敗で未サインインに戻ったときは送らない
  // （サインアウトは自分でマネージドログインの /logout へ移るので、ここから
  // 送るとその移動を潰す）
  const autoSignInRef = useRef(false);
  const [autoSignIn, setAutoSignIn] = useState(false);

  useEffect(() => {
    let active = true;

    // ポータルの目印はサインイン済みかどうかによらず、読み込みの最初に URL から消す
    if (landingRef.current === null) {
      landingRef.current = consumeSsoHint();
    }
    const landing = landingRef.current;

    // マネージドログインから ?code=... 付きで戻ってきたときは、Amplify が
    // configure の直後にトークン交換を始める。getCurrentUser はその完了を
    // 待ってから答えるので、戻ってきた直後でもここで拾える。
    // Hub は、交換が後から終わった場合と失敗した場合の受け口
    const stopListening = Hub.listen('auth', ({ payload }) => {
      switch (payload.event) {
        case 'signInWithRedirect':
        case 'signedIn':
          fetchAuthUser()
            .then((authUser) => {
              if (!active) return;
              clearAutoSignInMark();
              setUser(authUser);
              setError(null);
            })
            .catch(() => {
              if (active) setUser(null);
            });
          break;
        case 'signInWithRedirect_failure':
          console.error('マネージドログインからの戻りでサインインに失敗しました', payload.data);
          if (active) {
            setUser(null);
            setError(REDIRECT_FAILURE_MESSAGE);
            autoSignInRef.current = false;
            setAutoSignIn(false);
          }
          break;
        case 'signedOut':
        case 'tokenRefresh_failure':
          // 30日でリフレッシュトークンが切れたときなど。ログイン画面へ戻す
          if (active) setUser(null);
          break;
      }
    });

    fetchAuthUser()
      .then((authUser) => {
        if (!active) return;
        // サインインできているので、このタブの印は役目を終えた
        clearAutoSignInMark();
        setUser(authUser);
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        // `?error=` で戻ってきたときは、Amplify の失敗のイベントを待たずに文言を出す。
        // イベントはこの effect が受け口を張る前に流れてしまうことがある
        if (landing.oauthError) setError(REDIRECT_FAILURE_MESSAGE);
        // 印は送ると決めた時点で置く。置けなければ一度だけを守れないので、
        // 自動では送らずに画面を出す
        if (canAutoSignIn(landing) && markAutoSignIn()) {
          autoSignInRef.current = true;
          setAutoSignIn(true);
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
      stopListening();
    };
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      await signInWithRedirect();
    } catch (err) {
      // 別タブでサインイン済みなど、すでにトークンがある場合はそのまま入る
      if (err instanceof Error && err.name === 'UserAlreadyAuthenticatedException') {
        setUser(await fetchAuthUser());
        return;
      }
      throw err;
    }
  }, []);

  const takeAutoSignIn = useCallback(() => {
    if (!autoSignInRef.current) return false;
    autoSignInRef.current = false;
    setAutoSignIn(false);
    return true;
  }, []);

  const signOut = useCallback(async () => {
    // 端末に残る利用者固有のデータを消してからサインアウトする。
    // 相談の表示キャッシュや検索語には購入・飲酒の内容が含まれるため、
    // 共有端末で次の利用者に残さない。会話のセッション ID も捨てて、
    // 次の利用者が前の会話の続きとして相談できないようにする
    if (user) {
      clearMessages(user.userId);
      clearSessionId(user.userId);
      clearFilterState(user.userId);
    }
    // 画像の Presigned URL はメモリ上に最大 50 分残る。リロードを挟まずに
    // 次の利用者がサインインすると、前の利用者のキーで要求された URL が
    // キャッシュから返ってしまうため、ここで捨てる
    clearDownloadUrlCache();

    try {
      // OAuth の設定があるので、トークンを捨てたあとマネージドログインの
      // /logout へ移る。マネージドログイン側のセッションも切れるので、同じブラウザで
      // 開いている他のアプリも、次にトークンを取り直すときはログインからやり直しになる。
      // だから戻り先は、本番ではこのアプリではなく共通の入口にする（手元は自分の /）。
      // 別オリジンの戻り先は明示しないと Amplify が選ばないので、ここで渡す
      await amplifySignOut({
        global: false,
        oauth: { redirectUrl: signOutRedirectUrl(window.location.origin) },
      });
    } finally {
      // 上の通信を待つ間に書き戻されたものを、画面を落とす直前にもう一度消す。
      // 絞り込み条件は画面側の effect が、相談の表示キャッシュとセッション ID は
      // 進行中の応答が確定時に、画像 URL は表示中のカードが、それぞれ
      // 書き戻しうる（いずれも冪等）。
      //
      // finally に置くのは、サインアウトの通信が失敗しても端末にデータを
      // 残さないため。ここを飛ばすと、利用者はサインアウトしたつもりなのに
      // 画面はサインイン状態のまま、データも残るという最悪の形になる
      if (user) {
        clearMessages(user.userId);
        clearSessionId(user.userId);
        clearFilterState(user.userId);
      }
      clearDownloadUrlCache();
      setUser(null);
    }
  }, [user]);

  const value: AuthContextValue = {
    user,
    isAuthenticated: user !== null,
    isLoading,
    error,
    signIn,
    signOut,
    autoSignIn,
    takeAutoSignIn,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * 認証コンテキストを利用するカスタムフック
 *
 * Provider と対で使うものなので同じファイルに置く。開発時の Fast Refresh は
 * このファイルを触ったときだけ効かなくなるが、分けると読む側が2ファイルを
 * 行き来することになるため、そちらを優先する
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth は AuthProvider 内で使用してください');
  }
  return context;
}
