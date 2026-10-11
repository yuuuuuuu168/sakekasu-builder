// 未サインインで開いたときの自動サインイン。
//
// 開いた時点で未サインインなら、ボタンを押させずにタブごとに一度だけマネージドログインへ
// 送る。印（sessionStorage）があるとき・サインイン済みのとき・戻りの最中は送らず、
// 画面を出す。StrictMode で包むのは、effect が2回走っても1回しか送らないことを見るため

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Hub } from 'aws-amplify/utils';

const mockGetCurrentUser = vi.fn();
const mockSignInWithRedirect = vi.fn();

vi.mock('aws-amplify/auth', () => ({
  signInWithRedirect: (...args: unknown[]) => mockSignInWithRedirect(...args),
  signOut: vi.fn().mockResolvedValue(undefined),
  getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
}));

import { AuthProvider } from '../AuthContext';
import { AuthGuard } from '../components/AuthGuard';
import { AUTO_SIGN_IN_MARK_KEY } from '../autoSignIn';

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

function hasMark() {
  return window.sessionStorage.getItem(AUTO_SIGN_IN_MARK_KEY) !== null;
}

/** 少し待っても呼ばれないことを見るための間 */
function settle() {
  return new Promise((r) => setTimeout(r, 20));
}

describe('AuthProvider（未サインインで開いたときの自動サインイン）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    // 成功するとページごと遷移するので、テストでは終わらないままにしておく
    mockSignInWithRedirect.mockReturnValue(new Promise(() => {}));
  });

  it('未サインインなら、印を置いてから一度だけマネージドログインへ送る。画面は見せない', async () => {
    openAt('/records?a=1#top');
    mockGetCurrentUser.mockRejectedValue(new Error('UserUnAuthenticatedException'));

    renderApp();

    await waitFor(() => expect(mockSignInWithRedirect).toHaveBeenCalledTimes(1));
    expect(hasMark()).toBe(true);
    // 送っている間は読み込み中の表示のまま。見本の画面は一瞬も出さない
    expect(screen.getByTestId('auth-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-page')).not.toBeInTheDocument();
    expect(currentPath()).toBe('/records?a=1#top');

    await settle();
    expect(mockSignInWithRedirect).toHaveBeenCalledTimes(1);
  });

  it('ポータルの目印（?sso=1）が付いていても同じく一度だけ送り、URL から目印を消す', async () => {
    openAt('/records?a=1&sso=1#top');
    mockGetCurrentUser.mockRejectedValue(new Error('UserUnAuthenticatedException'));

    renderApp();

    await waitFor(() => expect(mockSignInWithRedirect).toHaveBeenCalledTimes(1));
    expect(currentPath()).toBe('/records?a=1#top');
  });

  it('印があれば（2回目）送らずに画面とボタンを出す', async () => {
    openAt('/');
    window.sessionStorage.setItem(AUTO_SIGN_IN_MARK_KEY, '1');
    mockGetCurrentUser.mockRejectedValue(new Error('UserUnAuthenticatedException'));

    renderApp();
    await screen.findByTestId('auth-page');

    expect(screen.getByTestId('signin-submit')).toHaveTextContent('パスキーでログイン');
    expect(screen.getByTestId('signin-submit')).not.toBeDisabled();
    expect(screen.queryByTestId('signin-error')).not.toBeInTheDocument();
    await settle();
    expect(mockSignInWithRedirect).not.toHaveBeenCalled();
  });

  it('印があってもボタンを押せば必ず送る', async () => {
    openAt('/');
    window.sessionStorage.setItem(AUTO_SIGN_IN_MARK_KEY, '1');
    mockGetCurrentUser.mockRejectedValue(new Error('UserUnAuthenticatedException'));

    renderApp();
    await screen.findByTestId('auth-page');

    act(() => screen.getByTestId('signin-submit').click());
    await waitFor(() => expect(mockSignInWithRedirect).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('signin-submit')).toBeDisabled();
  });

  it('?error= 付きで戻ってきたら送らず、失敗の文言を出す', async () => {
    openAt('/?error=access_denied&error_description=cancelled');
    mockGetCurrentUser.mockRejectedValue(new Error('UserUnAuthenticatedException'));

    renderApp();

    expect(await screen.findByTestId('signin-error')).toHaveTextContent(
      'サインインを完了できませんでした',
    );
    await settle();
    expect(mockSignInWithRedirect).not.toHaveBeenCalled();
    // 印の無いタブでも、戻りの失敗では印を置かない（次に開き直したときは一度送る）
    expect(hasMark()).toBe(false);
  });

  it('サインイン済みなら送らず、印を消し、URL から目印だけ消す', async () => {
    openAt('/?sso=1');
    window.sessionStorage.setItem(AUTO_SIGN_IN_MARK_KEY, '1');
    mockGetCurrentUser.mockResolvedValue({ userId: 'shared-sub' });

    renderApp();
    await screen.findByTestId('app-content');

    expect(currentPath()).toBe('/');
    expect(mockSignInWithRedirect).not.toHaveBeenCalled();
    expect(hasMark()).toBe(false);
  });

  it('戻ってきてサインインが完了したら印を消す', async () => {
    openAt('/');
    window.sessionStorage.setItem(AUTO_SIGN_IN_MARK_KEY, '1');
    mockGetCurrentUser.mockRejectedValue(new Error('UserUnAuthenticatedException'));

    renderApp();
    await screen.findByTestId('auth-page');
    expect(hasMark()).toBe(true);

    mockGetCurrentUser.mockResolvedValue({ userId: 'shared-sub' });
    act(() => {
      Hub.dispatch(
        'auth',
        { event: 'signInWithRedirect' } as never,
        'Auth',
        Symbol.for('amplify_default'),
      );
    });

    await screen.findByTestId('app-content');
    expect(hasMark()).toBe(false);
  });

  it('マネージドログインからの戻り（code 付き）の最中なら送らない', async () => {
    openAt('/?sso=1&code=abc&state=xyz');
    mockGetCurrentUser.mockRejectedValue(new Error('UserUnAuthenticatedException'));

    renderApp();
    await screen.findByTestId('auth-page');

    expect(currentPath()).toBe('/?code=abc&state=xyz');
    await settle();
    expect(mockSignInWithRedirect).not.toHaveBeenCalled();
  });

  it('送ろうとしてすでにサインイン済みと分かったら、そのまま入る', async () => {
    openAt('/');
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

  it('自動で送れなかったら（マネージドログインへ移れない）画面と文言を出す', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    openAt('/');
    mockGetCurrentUser.mockRejectedValue(new Error('UserUnAuthenticatedException'));
    mockSignInWithRedirect.mockRejectedValue(new Error('boom'));

    renderApp();

    expect(await screen.findByTestId('signin-error')).toHaveTextContent(
      'サインイン画面を開けませんでした',
    );
    expect(mockSignInWithRedirect).toHaveBeenCalledTimes(1);
  });
});
