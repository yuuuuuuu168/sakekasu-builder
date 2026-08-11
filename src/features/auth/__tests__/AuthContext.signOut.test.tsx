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

vi.mock('@/features/sommelier/lib/chatStorage', () => ({ clearMessages: vi.fn() }));
vi.mock('@/features/sommelier/lib/runtimeSend', () => ({ resetSommelierSession: vi.fn() }));
vi.mock('@/features/records/lib/filterStorage', () => ({ clearFilterState: vi.fn() }));

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
