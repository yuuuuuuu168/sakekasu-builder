import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { SendToSommelier } from '../types';

const amplifySignOut = vi.fn().mockResolvedValue(undefined);
vi.mock('aws-amplify/auth', () => ({
  signIn: vi.fn(),
  confirmSignIn: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  signOut: () => amplifySignOut(),
  getCurrentUser: vi.fn().mockResolvedValue({ userId: 'user-a', username: 'a' }),
  fetchUserAttributes: vi.fn().mockResolvedValue({ email: 'a@example.com' }),
}));

const { AuthProvider, useAuth } = await import('@/features/auth/AuthContext');
const { saveMessages, loadMessages, saveSessionId, loadSessionId } = await import(
  '../lib/chatStorage'
);
const { createSessionId } = await import('../lib/sessionId');
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

  it('会話のセッションも端末から消す（続きから話せてしまうため）', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user?.userId).toBe('user-a'));

    saveSessionId('user-a', createSessionId());

    await act(async () => {
      await result.current.signOut();
    });

    // セッションが残ると、次の利用者が前の相談の文脈を引き当ててしまう
    expect(loadSessionId('user-a')).toBeNull();
  });

  // 応答の保存は受信し終えてから行うので、サインアウトの後始末と競合する。
  // AuthContext は通信の前後で2回消しているが、2回目を消し終えてから画面が
  // 落ちるまでの間に応答が確定すると、そこで書き戻されて消えなくなる。
  // 画面の再描画を待たない、この一番危ない順序を再現する
  it('サインアウトを終えた直後に応答が確定しても会話を書き戻さない', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user?.userId).toBe('user-a'));

    const { useSommelierChat } = await import('../hooks/useSommelierChat');
    // 応答を止めたまま保持し、サインアウトの後に終わらせる
    let finish: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const hangingSend: SendToSommelier = async function* () {
      yield '燗酒がおすすめです';
      await pending;
    };

    const chat = renderHook(() => useSommelierChat(hangingSend, 'user-a'));
    act(() => {
      void chat.result.current.sendMessage('今夜のおすすめは？');
    });
    await waitFor(() => expect(chat.result.current.isResponding).toBe(true));

    await act(async () => {
      await result.current.signOut();
    });

    // 画面はまだ user-a のまま（setUser(null) の再描画が届く前）
    await act(async () => {
      finish();
      await pending;
    });

    expect(loadMessages('user-a')).toEqual([]);
    // 空配列を書いたのでもなく、そもそも書いていないこと
    expect(localStorage.getItem('sakekasu:sommelier-chat:user-a')).toBeNull();
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
