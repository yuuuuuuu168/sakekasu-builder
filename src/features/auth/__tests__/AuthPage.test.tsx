import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// useAuth フックをモック
const mockSignIn = vi.fn();
const mockConfirmSignInWithTotp = vi.fn();
const mockSignUp = vi.fn();
const mockConfirmSignUp = vi.fn();
const mockResetPassword = vi.fn();
const mockConfirmResetPassword = vi.fn();
const mockSignOut = vi.fn();

let mockAuthValue = {
  user: null as { userId: string; email: string } | null,
  isAuthenticated: false,
  isLoading: false,
  signIn: mockSignIn,
  confirmSignInWithTotp: mockConfirmSignInWithTotp,
  signUp: mockSignUp,
  confirmSignUp: mockConfirmSignUp,
  resetPassword: mockResetPassword,
  confirmResetPassword: mockConfirmResetPassword,
  signOut: mockSignOut,
};

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => mockAuthValue,
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { AuthPage } from '../components/AuthPage';
import { AuthGuard } from '../components/AuthGuard';

describe('AuthPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthValue = {
      user: null,
      isAuthenticated: false,
      isLoading: false,
      signIn: mockSignIn,
      confirmSignInWithTotp: mockConfirmSignInWithTotp,
      signUp: mockSignUp,
      confirmSignUp: mockConfirmSignUp,
      resetPassword: mockResetPassword,
      confirmResetPassword: mockConfirmResetPassword,
      signOut: mockSignOut,
    };
  });

  // Requirements 6.1, 6.2: 初期表示はサインインフォーム
  it('初期表示でサインインフォームが表示される', () => {
    render(<AuthPage />);

    expect(screen.getByTestId('signin-form')).toBeInTheDocument();
    expect(screen.getByText('サインイン')).toBeInTheDocument();
    expect(screen.queryByTestId('signup-form')).not.toBeInTheDocument();
  });

  // Requirements 6.3: サインアップフォームへの切り替え
  it('「こちら」リンクをクリックするとサインアップフォームに切り替わる', async () => {
    render(<AuthPage />);

    fireEvent.click(screen.getByTestId('switch-to-signup'));

    await waitFor(() => {
      expect(screen.getByTestId('signup-form')).toBeInTheDocument();
      expect(screen.getByText('アカウント作成')).toBeInTheDocument();
    });
  });

  // Requirements 6.2: サインインフォームへの切り替え（戻り）
  it('サインアップ画面から「こちら」リンクでサインインフォームに戻れる', async () => {
    render(<AuthPage />);

    // サインアップ画面へ
    fireEvent.click(screen.getByTestId('switch-to-signup'));
    await waitFor(() => {
      expect(screen.getByTestId('signup-form')).toBeInTheDocument();
    });

    // サインイン画面へ戻る
    fireEvent.click(screen.getByTestId('switch-to-signin'));
    await waitFor(() => {
      expect(screen.getByTestId('signin-form')).toBeInTheDocument();
    });
  });

  // Requirements 6.2: サインインフォームのエラーメッセージ表示
  it('サインイン失敗時にエラーメッセージが表示される', async () => {
    mockSignIn.mockRejectedValue({ name: 'NotAuthorizedException' });
    render(<AuthPage />);

    fireEvent.change(screen.getByTestId('input-email'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByTestId('input-password'), {
      target: { value: 'WrongPass1!' },
    });
    fireEvent.click(screen.getByTestId('signin-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('signin-error')).toHaveTextContent(
        'メールアドレスまたはパスワードが正しくありません',
      );
    });
  });

  // 画面から「登録があるかどうか」を読み取れないようにする（Cognito 側の設定が
  // 外れても、ここで文言が揃っていれば存在は漏れない）
  it('登録が無い場合もパスワード誤りと同じ文言を出す', async () => {
    async function messageFor(errorName: string): Promise<string> {
      mockSignIn.mockRejectedValue({ name: errorName });
      const view = render(<AuthPage />);

      fireEvent.change(screen.getByTestId('input-email'), {
        target: { value: 'someone@example.com' },
      });
      fireEvent.change(screen.getByTestId('input-password'), {
        target: { value: 'WrongPass1!' },
      });
      fireEvent.click(screen.getByTestId('signin-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('signin-error')).toBeInTheDocument();
      });
      const message = screen.getByTestId('signin-error').textContent ?? '';
      view.unmount();
      return message;
    }

    const notFound = await messageFor('UserNotFoundException');
    const wrongPassword = await messageFor('NotAuthorizedException');

    expect(notFound).toBe(wrongPassword);
    expect(notFound).toContain('メールアドレスまたはパスワードが正しくありません');
  });

  // 認証情報と無関係な失敗まで同じ文言にすると、原因を取り違えてしまう
  it('通信断などはパスワード誤りとは別の文言にする', async () => {
    mockSignIn.mockRejectedValue({ name: 'NetworkError' });
    render(<AuthPage />);

    fireEvent.change(screen.getByTestId('input-email'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByTestId('input-password'), {
      target: { value: 'Password1!' },
    });
    fireEvent.click(screen.getByTestId('signin-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('signin-error')).toHaveTextContent(
        'サインインに失敗しました。もう一度お試しください',
      );
    });
  });

  // Requirements 6.5: 未確認ユーザーのサインイン時に確認画面へ遷移
  it('未確認ユーザーのサインイン時にメール確認画面に遷移する', async () => {
    mockSignIn.mockRejectedValue({ name: 'UserNotConfirmedException' });
    render(<AuthPage />);

    fireEvent.change(screen.getByTestId('input-email'), {
      target: { value: 'unconfirmed@example.com' },
    });
    fireEvent.change(screen.getByTestId('input-password'), {
      target: { value: 'Password1!' },
    });
    fireEvent.click(screen.getByTestId('signin-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('confirm-form')).toBeInTheDocument();
      expect(screen.getByText('メール確認')).toBeInTheDocument();
    });
  });

  // Requirements 6.3: サインアップ後に確認画面へ遷移
  it('サインアップ成功後にメール確認画面に遷移する', async () => {
    mockSignUp.mockResolvedValue(undefined);
    render(<AuthPage />);

    // サインアップ画面へ
    fireEvent.click(screen.getByTestId('switch-to-signup'));
    await waitFor(() => {
      expect(screen.getByTestId('signup-form')).toBeInTheDocument();
    });

    // フォーム入力
    fireEvent.change(screen.getByTestId('input-email'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.change(screen.getByTestId('input-password'), {
      target: { value: 'ValidPass1!' },
    });
    fireEvent.click(screen.getByTestId('signup-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('confirm-form')).toBeInTheDocument();
      expect(screen.getByTestId('confirm-info')).toHaveTextContent(
        'new@example.com に確認コードを送信しました',
      );
    });
  });

  // Requirements 6.3: サインアップ時のエラーメッセージ表示
  it('既存メールアドレスでサインアップ時にエラーメッセージが表示される', async () => {
    mockSignUp.mockRejectedValue({ name: 'UsernameExistsException' });
    render(<AuthPage />);

    // サインアップ画面へ
    fireEvent.click(screen.getByTestId('switch-to-signup'));
    await waitFor(() => {
      expect(screen.getByTestId('signup-form')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('input-email'), {
      target: { value: 'existing@example.com' },
    });
    fireEvent.change(screen.getByTestId('input-password'), {
      target: { value: 'ValidPass1!' },
    });
    fireEvent.click(screen.getByTestId('signup-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('signup-error')).toHaveTextContent(
        'このメールアドレスは既に登録されています',
      );
    });
  });

  // Issue #70: MFA 有効ユーザーのサインイン
  describe('二段階認証（TOTP）', () => {
    /** サインインして TOTP 入力画面まで進める */
    async function signInUntilTotpChallenge() {
      mockSignIn.mockResolvedValue({ requiresTotp: true });
      render(<AuthPage />);

      fireEvent.change(screen.getByTestId('input-email'), {
        target: { value: 'mfa@example.com' },
      });
      fireEvent.change(screen.getByTestId('input-password'), {
        target: { value: 'Password1!' },
      });
      fireEvent.click(screen.getByTestId('signin-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('totp-challenge-form')).toBeInTheDocument();
      });
    }

    it('MFA 有効ユーザーのサインイン時に TOTP 入力画面へ遷移する', async () => {
      await signInUntilTotpChallenge();

      expect(screen.getByText('二段階認証')).toBeInTheDocument();
      expect(screen.getByTestId('input-totp-code')).toBeInTheDocument();
    });

    it('MFA 無効ユーザーは TOTP 入力画面に遷移しない', async () => {
      mockSignIn.mockResolvedValue({ requiresTotp: false });
      render(<AuthPage />);

      fireEvent.change(screen.getByTestId('input-email'), {
        target: { value: 'nomfa@example.com' },
      });
      fireEvent.change(screen.getByTestId('input-password'), {
        target: { value: 'Password1!' },
      });
      fireEvent.click(screen.getByTestId('signin-submit'));

      await waitFor(() => {
        expect(mockSignIn).toHaveBeenCalled();
      });
      expect(screen.queryByTestId('totp-challenge-form')).not.toBeInTheDocument();
    });

    it('入力したコードで confirmSignInWithTotp が呼ばれる', async () => {
      mockConfirmSignInWithTotp.mockResolvedValue(undefined);
      await signInUntilTotpChallenge();

      fireEvent.change(screen.getByTestId('input-totp-code'), {
        target: { value: '123456' },
      });
      fireEvent.click(screen.getByTestId('totp-submit'));

      await waitFor(() => {
        expect(mockConfirmSignInWithTotp).toHaveBeenCalledWith('123456');
      });
    });

    it('コード誤りのときにエラーメッセージが表示される', async () => {
      mockConfirmSignInWithTotp.mockRejectedValue({ name: 'CodeMismatchException' });
      await signInUntilTotpChallenge();

      fireEvent.change(screen.getByTestId('input-totp-code'), {
        target: { value: '000000' },
      });
      fireEvent.click(screen.getByTestId('totp-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('totp-error')).toHaveTextContent(
          '確認コードが正しくありません',
        );
      });
    });

    it('チャレンジ失効のときはサインインし直すよう促す', async () => {
      mockConfirmSignInWithTotp.mockRejectedValue({ name: 'SignInException' });
      await signInUntilTotpChallenge();

      fireEvent.change(screen.getByTestId('input-totp-code'), {
        target: { value: '123456' },
      });
      fireEvent.click(screen.getByTestId('totp-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('totp-error')).toHaveTextContent(
          'セッションの有効期限が切れました。もう一度サインインしてください',
        );
      });
    });

    it('「サインインからやり直す」でサインイン画面へ戻れる', async () => {
      await signInUntilTotpChallenge();

      fireEvent.click(screen.getByTestId('totp-back-to-signin'));

      await waitFor(() => {
        expect(screen.getByTestId('signin-form')).toBeInTheDocument();
      });
    });
  });

  // Issue #43: パスワードリセット
  describe('パスワード再設定', () => {
    /** コードを送信して確認ステップまで進める */
    async function requestUntilConfirmStep(email = 'reset@example.com') {
      mockResetPassword.mockResolvedValue(undefined);
      render(<AuthPage />);

      fireEvent.click(screen.getByTestId('forgot-password'));
      await waitFor(() => {
        expect(screen.getByTestId('reset-request-form')).toBeInTheDocument();
      });

      fireEvent.change(screen.getByTestId('input-reset-email'), {
        target: { value: email },
      });
      fireEvent.click(screen.getByTestId('reset-request-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('reset-confirm-form')).toBeInTheDocument();
      });
    }

    it('「パスワードを忘れた方はこちら」で再設定画面へ遷移する', async () => {
      render(<AuthPage />);

      fireEvent.click(screen.getByTestId('forgot-password'));

      await waitFor(() => {
        expect(screen.getByTestId('reset-request-form')).toBeInTheDocument();
        expect(screen.getByText('パスワード再設定')).toBeInTheDocument();
      });
    });

    it('サインイン画面で入力したメールアドレスが引き継がれる', async () => {
      render(<AuthPage />);

      fireEvent.change(screen.getByTestId('input-email'), {
        target: { value: 'carry@example.com' },
      });
      fireEvent.click(screen.getByTestId('forgot-password'));

      await waitFor(() => {
        expect(screen.getByTestId('input-reset-email')).toHaveValue('carry@example.com');
      });
    });

    // Issue #43: 管理者リセット（RESET_REQUIRED）でロックアウトされないようにする
    it('PasswordResetRequiredException のとき再設定画面へ誘導される', async () => {
      mockSignIn.mockRejectedValue({ name: 'PasswordResetRequiredException' });
      render(<AuthPage />);

      fireEvent.change(screen.getByTestId('input-email'), {
        target: { value: 'locked@example.com' },
      });
      fireEvent.change(screen.getByTestId('input-password'), {
        target: { value: 'OldPass1!' },
      });
      fireEvent.click(screen.getByTestId('signin-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('reset-request-form')).toBeInTheDocument();
        expect(screen.getByTestId('reset-request-info')).toHaveTextContent(
          'パスワードの再設定が必要です',
        );
        expect(screen.getByTestId('input-reset-email')).toHaveValue('locked@example.com');
      });
    });

    it('コード送信後に確認ステップへ進み、送信済みの文言が表示される', async () => {
      await requestUntilConfirmStep('reset@example.com');

      expect(mockResetPassword).toHaveBeenCalledWith('reset@example.com');
      expect(screen.getByTestId('reset-confirm-info')).toHaveTextContent(
        'reset@example.com 宛に確認コードを送信しました',
      );
    });

    it('コードと新パスワードで confirmResetPassword が呼ばれ、完了画面が表示される', async () => {
      mockConfirmResetPassword.mockResolvedValue(undefined);
      await requestUntilConfirmStep();

      fireEvent.change(screen.getByTestId('input-reset-code'), {
        target: { value: '123456' },
      });
      fireEvent.change(screen.getByTestId('input-reset-new-password'), {
        target: { value: 'NewPass1!' },
      });
      fireEvent.click(screen.getByTestId('reset-confirm-submit'));

      await waitFor(() => {
        expect(mockConfirmResetPassword).toHaveBeenCalledWith(
          'reset@example.com',
          '123456',
          'NewPass1!',
        );
        expect(screen.getByTestId('reset-done')).toBeInTheDocument();
      });

      // 完了画面からサインインへ戻れる
      fireEvent.click(screen.getByTestId('reset-done-to-signin'));
      await waitFor(() => {
        expect(screen.getByTestId('signin-form')).toBeInTheDocument();
      });
    });

    it('ポリシーを満たさない新パスワードは送信前に弾く', async () => {
      await requestUntilConfirmStep();

      fireEvent.change(screen.getByTestId('input-reset-code'), {
        target: { value: '123456' },
      });
      fireEvent.change(screen.getByTestId('input-reset-new-password'), {
        target: { value: 'weak' },
      });
      fireEvent.click(screen.getByTestId('reset-confirm-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('reset-error')).toHaveTextContent(
          'パスワードがポリシーを満たしていません',
        );
      });
      expect(mockConfirmResetPassword).not.toHaveBeenCalled();
    });

    it('確認コード誤りのときにエラーメッセージが表示される', async () => {
      mockConfirmResetPassword.mockRejectedValue({ name: 'CodeMismatchException' });
      await requestUntilConfirmStep();

      fireEvent.change(screen.getByTestId('input-reset-code'), {
        target: { value: '000000' },
      });
      fireEvent.change(screen.getByTestId('input-reset-new-password'), {
        target: { value: 'NewPass1!' },
      });
      fireEvent.click(screen.getByTestId('reset-confirm-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('reset-error')).toHaveTextContent(
          '確認コードが正しくありません',
        );
      });
    });

    it('試行回数超過のときは時間をおくよう促す', async () => {
      mockResetPassword.mockRejectedValue({ name: 'LimitExceededException' });
      render(<AuthPage />);

      fireEvent.click(screen.getByTestId('forgot-password'));
      await waitFor(() => {
        expect(screen.getByTestId('reset-request-form')).toBeInTheDocument();
      });

      fireEvent.change(screen.getByTestId('input-reset-email'), {
        target: { value: 'reset@example.com' },
      });
      fireEvent.click(screen.getByTestId('reset-request-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('reset-error')).toHaveTextContent(
          '試行回数が上限に達しました。しばらく時間をおいてお試しください',
        );
      });
    });

    it('「サインインに戻る」でサインイン画面へ戻れる', async () => {
      render(<AuthPage />);

      fireEvent.click(screen.getByTestId('forgot-password'));
      await waitFor(() => {
        expect(screen.getByTestId('reset-request-form')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('reset-back-to-signin'));
      await waitFor(() => {
        expect(screen.getByTestId('signin-form')).toBeInTheDocument();
      });
    });
  });
});

describe('AuthGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Requirements 6.1: ローディング中の表示
  it('ローディング中はローディング表示を返す', () => {
    mockAuthValue = {
      user: null,
      isAuthenticated: false,
      isLoading: true,
      signIn: mockSignIn,
      confirmSignInWithTotp: mockConfirmSignInWithTotp,
      signUp: mockSignUp,
      confirmSignUp: mockConfirmSignUp,
      resetPassword: mockResetPassword,
      confirmResetPassword: mockConfirmResetPassword,
      signOut: mockSignOut,
    };

    render(
      <AuthGuard>
        <div data-testid="protected-content">保護されたコンテンツ</div>
      </AuthGuard>,
    );

    expect(screen.getByTestId('auth-loading')).toBeInTheDocument();
    expect(screen.getByText('読み込み中...')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('auth-page')).not.toBeInTheDocument();
  });

  // Requirements 6.1: 未認証時は認証ページを表示
  it('未認証時は AuthPage を表示する', () => {
    mockAuthValue = {
      user: null,
      isAuthenticated: false,
      isLoading: false,
      signIn: mockSignIn,
      confirmSignInWithTotp: mockConfirmSignInWithTotp,
      signUp: mockSignUp,
      confirmSignUp: mockConfirmSignUp,
      resetPassword: mockResetPassword,
      confirmResetPassword: mockConfirmResetPassword,
      signOut: mockSignOut,
    };

    render(
      <AuthGuard>
        <div data-testid="protected-content">保護されたコンテンツ</div>
      </AuthGuard>,
    );

    expect(screen.getByTestId('auth-page')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });

  // Requirements 6.5: 認証済みの場合は children を表示
  it('認証済みの場合は children を表示する', () => {
    mockAuthValue = {
      user: { userId: 'user-123', email: 'test@example.com' },
      isAuthenticated: true,
      isLoading: false,
      signIn: mockSignIn,
      confirmSignInWithTotp: mockConfirmSignInWithTotp,
      signUp: mockSignUp,
      confirmSignUp: mockConfirmSignUp,
      resetPassword: mockResetPassword,
      confirmResetPassword: mockConfirmResetPassword,
      signOut: mockSignOut,
    };

    render(
      <AuthGuard>
        <div data-testid="protected-content">保護されたコンテンツ</div>
      </AuthGuard>,
    );

    expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    expect(screen.getByText('保護されたコンテンツ')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('auth-loading')).not.toBeInTheDocument();
  });
});
