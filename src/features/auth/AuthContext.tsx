import {
  createContext,
  useContext,
  useEffect,
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

  useEffect(() => {
    let active = true;

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
        if (active) setUser(authUser);
      })
      .catch(() => {
        if (active) setUser(null);
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
      // /logout へ移り、戻り先（このオリジンの /）へ帰ってくる。
      // マネージドログイン側のセッションも切れるので、同じブラウザで開いている
      // 他のアプリも、次にトークンを取り直すときはログインからやり直しになる
      await amplifySignOut();
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
