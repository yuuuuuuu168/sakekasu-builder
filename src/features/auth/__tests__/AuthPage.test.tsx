import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockSignIn = vi.fn();
let mockError: string | null = null;
let mockAutoSignIn = false;

vi.mock('../AuthContext', () => ({
  useAuth: () => ({
    signIn: mockSignIn,
    error: mockError,
    autoSignIn: mockAutoSignIn,
    takeAutoSignIn: () => {
      const taken = mockAutoSignIn;
      mockAutoSignIn = false;
      return taken;
    },
  }),
}));

import { AuthPage } from '../components/AuthPage';

describe('AuthPage', () => {
  beforeEach(() => {
    mockSignIn.mockReset();
    mockError = null;
    mockAutoSignIn = false;
    document.documentElement.className = '';
  });

  // 独自のサインイン・サインアップ・パスワード再設定の画面はもう無い。
  // 入力欄を持たず、共通ログインへ送るボタンだけを出す
  it('入力欄を持たず、入口の表紙と同じ並びでログインのボタンだけを出す', () => {
    render(<AuthPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('酒カス');
    expect(screen.getByText('日本酒の記録')).toBeInTheDocument();
    expect(screen.getByTestId('signin-submit')).toHaveTextContent('パスキーでログイン');
    expect(screen.getByText('共通ログインの画面へ移動します')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← sakekasu の入口へ' })).toHaveAttribute(
      'href',
      'https://sakekasu-builder.com/',
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/アカウント作成/)).not.toBeInTheDocument();
    expect(screen.queryByText(/パスワードを忘れた/)).not.toBeInTheDocument();
  });

  it('ボタンを押すとマネージドログインへ送る', async () => {
    mockSignIn.mockResolvedValue(undefined);
    render(<AuthPage />);
    fireEvent.click(screen.getByTestId('signin-submit'));
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledTimes(1));
  });

  it('マネージドログインへ移れなかったら文言を出す', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSignIn.mockRejectedValue(new Error('boom'));
    render(<AuthPage />);
    fireEvent.click(screen.getByTestId('signin-submit'));
    expect(await screen.findByTestId('signin-error')).toHaveTextContent(
      'サインイン画面を開けませんでした',
    );
    expect(screen.getByTestId('signin-submit')).not.toBeDisabled();
  });

  it('自動で送るときは一度だけ送り、画面は見せずに読み込み中の表示にする', async () => {
    mockAutoSignIn = true;
    mockSignIn.mockReturnValue(new Promise(() => {}));
    render(<AuthPage />);
    expect(screen.getByTestId('auth-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-page')).not.toBeInTheDocument();
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledTimes(1));
  });

  it('戻りで失敗した文言があるときは、自動で送らずに画面を出す', async () => {
    mockAutoSignIn = true;
    mockError = 'サインインを完了できませんでした。もう一度お試しください';
    render(<AuthPage />);
    expect(screen.getByTestId('auth-page')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('履歴のキャッシュから戻されたら、移動中をやめてボタンを押せるようにする', async () => {
    mockSignIn.mockReturnValue(new Promise(() => {}));
    render(<AuthPage />);
    fireEvent.click(screen.getByTestId('signin-submit'));
    await waitFor(() => expect(screen.getByTestId('signin-submit')).toBeDisabled());

    const event = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(event, 'persisted', { value: true });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(screen.getByTestId('signin-submit')).not.toBeDisabled();
    expect(screen.getByTestId('signin-submit')).toHaveTextContent('パスキーでログイン');
  });

  it('出している間だけ <html> に黒地のクラスを付ける', () => {
    const { unmount } = render(<AuthPage />);
    expect(document.documentElement).toHaveClass('signin-active');
    unmount();
    expect(document.documentElement).not.toHaveClass('signin-active');
  });

  it('戻りで失敗したときの文言を出す', () => {
    mockError = 'サインインを完了できませんでした。もう一度お試しください';
    render(<AuthPage />);
    expect(screen.getByTestId('signin-error')).toHaveTextContent('サインインを完了できませんでした');
  });
});
