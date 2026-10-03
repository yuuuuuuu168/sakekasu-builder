import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockSignIn = vi.fn();
let mockError: string | null = null;

vi.mock('../AuthContext', () => ({
  useAuth: () => ({ signIn: mockSignIn, error: mockError }),
}));

import { AuthPage } from '../components/AuthPage';

describe('AuthPage', () => {
  beforeEach(() => {
    mockSignIn.mockReset();
    mockError = null;
  });

  // 独自のサインイン・サインアップ・パスワード再設定の画面はもう無い。
  // 入力欄を持たず、共通ログインへ送るボタンだけを出す
  it('入力欄を持たず、サインインのボタンだけを出す', () => {
    render(<AuthPage />);
    expect(screen.getByTestId('signin-submit')).toBeInTheDocument();
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

  it('戻りで失敗したときの文言を出す', () => {
    mockError = 'サインインを完了できませんでした。もう一度お試しください';
    render(<AuthPage />);
    expect(screen.getByTestId('signin-error')).toHaveTextContent('サインインを完了できませんでした');
  });
});
