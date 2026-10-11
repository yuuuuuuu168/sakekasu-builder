// 共通ポータルから `?sso=1` 付きで来たときの自動サインイン。
//
// 目印があって未サインインのときだけ、ボタンを押させずにマネージドログインへ
// 送る。目印が無いとき・サインイン済みのとき・戻りの最中は送らない。
// StrictMode で包むのは、effect が2回走っても1回しか送らないことを見るため

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';

const mockGetCurrentUser = vi.fn();
const mockSignInWithRedirect = vi.fn();

vi.mock('aws-amplify/auth', () => ({
  signInWithRedirect: (...args: unknown[]) => mockSignInWithRedirect(...args),
  signOut: vi.fn().mockResolvedValue(undefined),
  getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
}));

import { AuthProvider } from '../AuthContext';
import { AuthGuard } from '../components/AuthGuard';

function renderApp() {
  return render(
    <StrictMode>
      <AuthProvider>
        <AuthGuard>
          <div data-testid="app-content">app</div>
        </AuthGuard>
      </AuthProvider>
    </StrictMode>,
  );
}

function openAt(pathAndQuery: string) {
  window.history.replaceState(null, '', pathAndQuery);
}

function currentPath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/** 未サインインのまま読み込みを終えた（ボタンか移動中の表示が出た）ことを待つ */
async function waitForAuthPage() {
  await screen.findByTestId('auth-page');
}

describe('AuthProvider（共通ポータルからの自動サインイン）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 成功するとページごと遷移するので、テストでは終わらないままにしておく
    mockSignInWithRedirect.mockReturnValue(new Promise(() => {}));
  });

  it('目印があって未サインインなら、一度だけマネージドログインへ送り、URL から目印を消す', async () => {
    openAt('/records?a=1&sso=1#top');
    mockGetCurrentUser.mockRejectedValue(new Error('UserUnAuthenticatedException'));

    renderApp();
    await waitForAuthPage();

    await waitFor(() => expect(mockSignInWithRedirect).toHaveBeenCalledTimes(1));
    expect(currentPath()).toBe('/records?a=1#top');
    // ボタンを見せずに「移動中」の表示にする
    expect(screen.getByTestId('signin-submit')).toHaveTextContent('サインイン画面へ移動中...');
    expect(screen.getByTestId('signin-submit')).toBeDisabled();

    // 少し待っても2回目は無い
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSignInWithRedirect).toHaveBeenCalledTimes(1);
  });

  it('目印が無ければ送らず、ボタンを出す', async () => {
    openAt('/');
    mockGetCurrentUser.mockRejectedValue(new Error('UserUnAuthenticatedException'));

    renderApp();
    await waitForAuthPage();

    expect(screen.getByTestId('signin-submit')).toHaveTextContent('🍶 サインイン');
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSignInWithRedirect).not.toHaveBeenCalled();
  });

  it('サインイン済みなら送らず、URL から目印だけ消す', async () => {
    openAt('/?sso=1');
    mockGetCurrentUser.mockResolvedValue({ userId: 'shared-sub' });

    renderApp();
    await screen.findByTestId('app-content');

    expect(currentPath()).toBe('/');
    expect(mockSignInWithRedirect).not.toHaveBeenCalled();
  });

  it('マネージドログインからの戻り（code 付き）の最中なら送らない', async () => {
    openAt('/?sso=1&code=abc&state=xyz');
    mockGetCurrentUser.mockRejectedValue(new Error('UserUnAuthenticatedException'));

    renderApp();
    await waitForAuthPage();

    expect(currentPath()).toBe('/?code=abc&state=xyz');
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSignInWithRedirect).not.toHaveBeenCalled();
  });

  it('戻りのエラー（error 付き）のときも送らない', async () => {
    openAt('/?sso=1&error=access_denied');
    mockGetCurrentUser.mockRejectedValue(new Error('UserUnAuthenticatedException'));

    renderApp();
    await waitForAuthPage();

    await new Promise((r) => setTimeout(r, 20));
    expect(mockSignInWithRedirect).not.toHaveBeenCalled();
    expect(screen.getByTestId('signin-submit')).toHaveTextContent('🍶 サインイン');
  });

  it('送ろうとしてすでにサインイン済みと分かったら、そのまま入る', async () => {
    openAt('/?sso=1');
    // StrictMode で読み込みの確認が2回走るので、2回とも未サインインと答える
    mockGetCurrentUser
      .mockRejectedValueOnce(new Error('UserUnAuthenticatedException'))
      .mockRejectedValueOnce(new Error('UserUnAuthenticatedException'));
    const already = new Error('already');
    already.name = 'UserAlreadyAuthenticatedException';
    mockSignInWithRedirect.mockRejectedValue(already);
    mockGetCurrentUser.mockResolvedValue({ userId: 'shared-sub' });

    renderApp();

    await screen.findByTestId('app-content');
    expect(mockSignInWithRedirect).toHaveBeenCalledTimes(1);
  });
});
