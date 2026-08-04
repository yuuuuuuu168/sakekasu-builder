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
  signUp as amplifySignUp,
  confirmSignUp as amplifyConfirmSignUp,
  signOut as amplifySignOut,
  getCurrentUser,
  fetchUserAttributes,
} from 'aws-amplify/auth';
import { clearMessages } from '@/features/sommelier/lib/chatStorage';
import { resetSommelierSession } from '@/features/sommelier/lib/runtimeSend';

/** 認証済みユーザーの型 */
export interface AuthUser {
  userId: string;
  email: string;
}

/** 認証コンテキストの値 */
export interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
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

  const signIn = useCallback(async (email: string, password: string) => {
    await amplifySignIn({ username: email, password });
    const authUser = await fetchAuthUser();
    setUser(authUser);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    await amplifySignUp({ username: email, password });
  }, []);

  const confirmSignUp = useCallback(async (email: string, code: string) => {
    await amplifyConfirmSignUp({ username: email, confirmationCode: code });
  }, []);

  const signOut = useCallback(async () => {
    // 端末に残る利用者固有のデータを消してからサインアウトする。
    // 相談履歴には購入・飲酒の内容が含まれるため、共有端末で
    // 次の利用者に残さない。Runtime のセッションも切り替える
    if (user) {
      clearMessages(user.userId);
    }
    resetSommelierSession();

    await amplifySignOut();
    setUser(null);
  }, [user]);

  const value: AuthContextValue = {
    user,
    isAuthenticated: user !== null,
    isLoading,
    signIn,
    signUp,
    confirmSignUp,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** 認証コンテキストを利用するカスタムフック */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth は AuthProvider 内で使用してください');
  }
  return context;
}
