// サインアウト時に端末へ残る利用者データを捨てることの確認。
//
// 画像の Presigned URL はモジュールレベルのキャッシュに最大 50 分残る。
// リロードを挟まずに次の利用者がサインインすると、前の利用者のキーで
// 取得済みの URL がそのまま返ってしまうため、サインアウトで捨てる。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';

const mockSignOut = vi.fn();
const mockGetCurrentUser = vi.fn();
const mockFetchUserAttributes = vi.fn();
const mockGraphql = vi.fn();

vi.mock('aws-amplify/auth', () => ({
  signIn: vi.fn(),
  confirmSignIn: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  resetPassword: vi.fn(),
  confirmResetPassword: vi.fn(),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
  fetchUserAttributes: (...args: unknown[]) => mockFetchUserAttributes(...args),
}));

vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({ graphql: (...args: unknown[]) => mockGraphql(...args) }),
}));

const mockClearMessages = vi.fn();
const mockClearFilterState = vi.fn();

vi.mock('@/features/sommelier/lib/chatStorage', () => ({
  clearMessages: (...args: unknown[]) => mockClearMessages(...args),
}));
vi.mock('@/features/sommelier/lib/runtimeSend', () => ({ resetSommelierSession: vi.fn() }));
vi.mock('@/features/records/lib/filterStorage', () => ({
  clearFilterState: (...args: unknown[]) => mockClearFilterState(...args),
}));

import { AuthProvider, useAuth } from '../AuthContext';
import { fetchDownloadUrl, clearDownloadUrlCache } from '@/features/image/lib/downloadUrlCache';

const wrapper = ({ children }: { children: ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

const KEY = 'user-a-sub/purchase/rec-1/label.jpg';

describe('AuthProvider の signOut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDownloadUrlCache();

    mockGetCurrentUser.mockResolvedValue({ userId: 'user-a' });
    mockFetchUserAttributes.mockResolvedValue({ email: 'a@example.com' });
    mockSignOut.mockResolvedValue(undefined);
    mockGraphql.mockImplementation(async (arg: { variables: { keys: string[] } }) => ({
      data: { getDownloadUrls: arg.variables.keys.map(() => 'https://example/signed') },
    }));
  });

  it('サインアウトすると画像 URL のキャッシュを捨てる', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    // 前の利用者の画像 URL をキャッシュに載せる
    await fetchDownloadUrl(KEY);
    expect(mockGraphql).toHaveBeenCalledTimes(1);

    // キャッシュが効いている状態を確認しておく（サーバーへ行かない）
    await fetchDownloadUrl(KEY);
    expect(mockGraphql).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.signOut();
    });

    // サインアウト後は同じキーでもサーバーに取り直す
    await fetchDownloadUrl(KEY);
    expect(mockGraphql).toHaveBeenCalledTimes(2);
  });

  // 通信の待ち時間に、画面側の effect や進行中の応答がデータを書き戻す。
  // 通信の後にもう一度消していないと、消したはずのものが残る
  it('サインアウトの通信の前後で、端末に残るデータを2回消す', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    mockClearMessages.mockClear();
    mockClearFilterState.mockClear();

    await act(async () => {
      await result.current.signOut();
    });

    expect(mockClearMessages).toHaveBeenCalledTimes(2);
    expect(mockClearFilterState).toHaveBeenCalledTimes(2);
  });

  // サインアウトが失敗したときが一番まずい。利用者はサインアウトしたつもりで
  // 端末を離れるのに、画面はサインイン状態でデータも残ることになる
  it('サインアウトの通信が失敗しても、状態とキャッシュは片付ける', async () => {
    mockSignOut.mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    await fetchDownloadUrl(KEY);
    expect(mockGraphql).toHaveBeenCalledTimes(1);

    // 失敗は呼び出し元に伝える（利用者に知らせるため握り潰さない）
    await act(async () => {
      await expect(result.current.signOut()).rejects.toThrow('network');
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);

    // キャッシュも残らない
    await fetchDownloadUrl(KEY);
    expect(mockGraphql).toHaveBeenCalledTimes(2);
  });

  it('サインアウト自体は従来どおり実行される', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    await act(async () => {
      await result.current.signOut();
    });

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(result.current.user).toBeNull();
  });
});
