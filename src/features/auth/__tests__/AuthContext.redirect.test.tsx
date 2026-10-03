// 共通ログイン（マネージドログイン）からの戻りの扱い。
// Hub の signInWithRedirect / signInWithRedirect_failure を受けて状態を変える。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Hub } from 'aws-amplify/utils';

const mockGetCurrentUser = vi.fn();
const mockSignInWithRedirect = vi.fn();

vi.mock('aws-amplify/auth', () => ({
  signInWithRedirect: (...args: unknown[]) => mockSignInWithRedirect(...args),
  signOut: vi.fn().mockResolvedValue(undefined),
  getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
}));

import { AuthProvider, useAuth } from '../AuthContext';

const wrapper = ({ children }: { children: ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

/** Amplify が内部で流すのと同じ形のイベントを流す */
function dispatchAuth(event: string, data?: unknown) {
  // 'auth' チャンネルは Amplify 内部用に予約されているが、テストでは受け手の
  // 振る舞いを見たいだけなので、警告を出さずに流せる形で投げる
  Hub.dispatch('auth', { event, data } as never, 'Auth', Symbol.for('amplify_default'));
}

describe('AuthProvider（共通ログインからの戻り）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('トークンが無ければ未サインインで読み込みを終える', async () => {
    mockGetCurrentUser.mockRejectedValue(new Error('UserUnAuthenticatedException'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('戻ってきてサインインが完了したら、sub を利用者として立てる', async () => {
    mockGetCurrentUser.mockRejectedValueOnce(new Error('UserUnAuthenticatedException'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockGetCurrentUser.mockResolvedValue({ userId: 'shared-sub', username: 'x' });
    act(() => dispatchAuth('signInWithRedirect'));

    await waitFor(() => expect(result.current.user).toEqual({ userId: 'shared-sub' }));
  });

  it('戻りで失敗したら未サインインのまま文言を持つ', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetCurrentUser.mockRejectedValue(new Error('UserUnAuthenticatedException'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => dispatchAuth('signInWithRedirect_failure', { error: new Error('invalid_grant') }));

    await waitFor(() => expect(result.current.error).toMatch(/サインインを完了できませんでした/));
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('リフレッシュに失敗したら未サインインに戻す', async () => {
    mockGetCurrentUser.mockResolvedValue({ userId: 'shared-sub' });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    act(() => dispatchAuth('tokenRefresh_failure'));

    await waitFor(() => expect(result.current.isAuthenticated).toBe(false));
  });

  it('signIn はマネージドログインへのリダイレクトを始める', async () => {
    mockGetCurrentUser.mockRejectedValue(new Error('UserUnAuthenticatedException'));
    mockSignInWithRedirect.mockResolvedValue(undefined);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.signIn();
    });
    expect(mockSignInWithRedirect).toHaveBeenCalledTimes(1);
  });

  it('すでにサインイン済みなら、リダイレクトせずにそのまま入る', async () => {
    mockGetCurrentUser.mockRejectedValueOnce(new Error('UserUnAuthenticatedException'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const already = new Error('already');
    already.name = 'UserAlreadyAuthenticatedException';
    mockSignInWithRedirect.mockRejectedValue(already);
    mockGetCurrentUser.mockResolvedValue({ userId: 'shared-sub' });

    await act(async () => {
      await result.current.signIn();
    });
    expect(result.current.user).toEqual({ userId: 'shared-sub' });
  });
});
