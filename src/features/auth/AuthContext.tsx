import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import {
  signIn as amplifySignIn,
  confirmSignIn as amplifyConfirmSignIn,
  signUp as amplifySignUp,
  confirmSignUp as amplifyConfirmSignUp,
  resetPassword as amplifyResetPassword,
  confirmResetPassword as amplifyConfirmResetPassword,
  signOut as amplifySignOut,
  getCurrentUser,
  fetchUserAttributes,
} from 'aws-amplify/auth';
import { clearMessages } from '@/features/sommelier/lib/chatStorage';
import { resetSommelierSession } from '@/features/sommelier/lib/runtimeSend';
import { clearFilterState } from '@/features/records/lib/filterStorage';
import { clearDownloadUrlCache } from '@/features/image/lib/downloadUrlCache';

/** 認証済みユーザーの型 */
export interface AuthUser {
  userId: string;
  email: string;
}

/** サインインの結果。MFA 有効な利用者は TOTP コードの入力が続きに必要になる */
export interface SignInResult {
  requiresTotp: boolean;
}

/** 認証コンテキストの値 */
export interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  confirmSignInWithTotp: (code: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  confirmResetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** 現在の認証ユーザー情報を取得するヘルパー */
async function fetchAuthUser(): Promise<AuthUser> {
  const currentUser = await getCurrentUser();
  const attributes = await fetchUserAttributes();
  return {
    userId: currentUser.userId,
    email: attributes.email ?? '',
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 初回マウント時に認証状態を確認
  useEffect(() => {
    fetchAuthUser()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<SignInResult> => {
    const { isSignedIn, nextStep } = await amplifySignIn({ username: email, password });

    // MFA を有効にしている利用者は、ここではまだサインインが完了していない。
    // TOTP コードを confirmSignInWithTotp で送るまで user は立てない
    if (nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_TOTP_CODE') {
      return { requiresTotp: true };
    }

    if (!isSignedIn) {
      // MFA 必須化など、想定していないチャレンジが来たときに
      // 未サインインのまま画面へ進めてしまわないよう明示的に落とす
      throw new Error(`未対応のサインインステップです: ${nextStep.signInStep}`);
    }

    const authUser = await fetchAuthUser();
    setUser(authUser);
    return { requiresTotp: false };
  }, []);

  const confirmSignInWithTotp = useCallback(async (code: string) => {
    const { isSignedIn } = await amplifyConfirmSignIn({ challengeResponse: code });
    if (!isSignedIn) {
      throw new Error('TOTP コードの検証後もサインインが完了しませんでした');
    }
    const authUser = await fetchAuthUser();
    setUser(authUser);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    await amplifySignUp({ username: email, password });
  }, []);

  const confirmSignUp = useCallback(async (email: string, code: string) => {
    await amplifyConfirmSignUp({ username: email, confirmationCode: code });
  }, []);

  // preventUserExistenceErrors 有効時は、存在しないメールアドレスでも
  // Cognito が成功と同じ応答を返す。ここで戻り値を握りつぶしているのは
  // それを画面に区別させないため（存在の有無を推測させない）
  const resetPassword = useCallback(async (email: string) => {
    await amplifyResetPassword({ username: email });
  }, []);

  const confirmResetPassword = useCallback(
    async (email: string, code: string, newPassword: string) => {
      await amplifyConfirmResetPassword({
        username: email,
        confirmationCode: code,
        newPassword,
      });
    },
    [],
  );

  const signOut = useCallback(async () => {
    // 端末に残る利用者固有のデータを消してからサインアウトする。
    // 相談履歴や検索語には購入・飲酒の内容が含まれるため、共有端末で
    // 次の利用者に残さない。Runtime のセッションも切り替える
    if (user) {
      clearMessages(user.userId);
      clearFilterState(user.userId);
    }
    resetSommelierSession();
    // 画像の Presigned URL はメモリ上に最大 50 分残る。リロードを挟まずに
    // 次の利用者がサインインすると、前の利用者のキーで要求された URL が
    // キャッシュから返ってしまうため、ここで捨てる
    clearDownloadUrlCache();

    try {
      await amplifySignOut();
    } finally {
      // 上の通信を待つ間に書き戻されたものを、画面を落とす直前にもう一度消す。
      // 絞り込み条件は画面側の effect が、相談履歴は進行中の応答が確定時に、
      // 画像 URL は表示中のカードが、それぞれ書き戻しうる（いずれも冪等）。
      //
      // finally に置くのは、サインアウトの通信が失敗しても端末にデータを
      // 残さないため。ここを飛ばすと、利用者はサインアウトしたつもりなのに
      // 画面はサインイン状態のまま、データも残るという最悪の形になる
      if (user) {
        clearMessages(user.userId);
        clearFilterState(user.userId);
      }
      clearDownloadUrlCache();
      // セッション ID は次のリクエストが来た時点で作り直されて残るため、
      // 通信を待つ間に相談が走ると次の利用者へ引き継がれてしまう。
      // Runtime 側の会話文脈が混ざらないよう、ここでも切り替える
      resetSommelierSession();
      setUser(null);
    }
  }, [user]);

  const value: AuthContextValue = {
    user,
    isAuthenticated: user !== null,
    isLoading,
    signIn,
    confirmSignInWithTotp,
    signUp,
    confirmSignUp,
    resetPassword,
    confirmResetPassword,
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
