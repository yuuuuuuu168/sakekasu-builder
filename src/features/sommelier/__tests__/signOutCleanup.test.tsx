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
});
