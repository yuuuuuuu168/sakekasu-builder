import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const amplifySignOut = vi.fn().mockResolvedValue(undefined);
vi.mock('aws-amplify/auth', () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  signOut: () => amplifySignOut(),
  getCurrentUser: vi.fn().mockResolvedValue({ userId: 'user-a', username: 'a' }),
  fetchUserAttributes: vi.fn().mockResolvedValue({ email: 'a@example.com' }),
}));

const { AuthProvider, useAuth } = await import('@/features/auth/AuthContext');
const { saveMessages, loadMessages } = await import('../lib/chatStorage');
const { saveFilterState, loadFilterState, DEFAULT_FILTER_STATE } = await import(
  '@/features/records/lib/filterStorage'
);

const wrapper = ({ children }: { children: ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe('サインアウト時の後始末', () => {
  beforeEach(() => {
    localStorage.clear();
    amplifySignOut.mockClear();
  });

  it('相談履歴を端末から消してからサインアウトする', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user?.userId).toBe('user-a'));

    saveMessages('user-a', [
      { id: 'm1', role: 'user', content: '今夜のおすすめは？' },
    ]);
    expect(loadMessages('user-a')).toHaveLength(1);

    await act(async () => {
      await result.current.signOut();
    });

    // 共有端末で次の利用者に相談内容が残らないこと
    expect(loadMessages('user-a')).toEqual([]);
    expect(amplifySignOut).toHaveBeenCalled();
    expect(result.current.user).toBeNull();
  });

  it('絞り込み条件も端末から消す（検索語に銘柄名が残るため）', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user?.userId).toBe('user-a'));

    saveFilterState('user-a', { ...DEFAULT_FILTER_STATE, searchQuery: '山崎' });

    await act(async () => {
      await result.current.signOut();
    });

    expect(loadFilterState('user-a')).toEqual(DEFAULT_FILTER_STATE);
  });

  it('サインアウト通信の最中に条件が保存し直されても残らない', async () => {
    // 画面側は effect で保存し続けるため、通信を待つ間の書き戻しを再現する
    amplifySignOut.mockImplementationOnce(async () => {
      saveFilterState('user-a', { ...DEFAULT_FILTER_STATE, searchQuery: '獺祭' });
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user?.userId).toBe('user-a'));

    await act(async () => {
      await result.current.signOut();
    });

    expect(loadFilterState('user-a')).toEqual(DEFAULT_FILTER_STATE);
  });
});
