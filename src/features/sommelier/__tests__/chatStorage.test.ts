import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  beginMessagesWrite,
  loadMessages,
  saveMessages,
  clearMessages,
  loadSessionId,
  saveSessionId,
  clearSessionId,
  MAX_STORED_MESSAGES,
} from '../lib/chatStorage';
import { createSessionId } from '../lib/sessionId';
import type { ChatMessage } from '../types';

const message = (id: string, content: string): ChatMessage => ({
  id,
  role: 'user',
  content,
});

describe('相談履歴の保存', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('保存した履歴を読み戻せる', () => {
    const messages = [message('m1', 'こんばんは'), message('m2', 'おすすめは？')];
    saveMessages('user-a', messages);

    expect(loadMessages('user-a')).toEqual(messages);
  });

  it('ユーザーごとに履歴が分かれる（他人の履歴が見えない）', () => {
    saveMessages('user-a', [message('m1', 'Aの相談')]);

    expect(loadMessages('user-b')).toEqual([]);
  });

  it('履歴がない場合は空配列を返す', () => {
    expect(loadMessages('user-a')).toEqual([]);
  });

  it('userId が空なら保存も読み込みもしない', () => {
    saveMessages('', [message('m1', '未ログイン')]);

    expect(loadMessages('')).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it('受信中フラグは復元しない', () => {
    saveMessages('user-a', [
      { id: 'm1', role: 'assistant', content: '途中', isStreaming: true },
    ]);

    const loaded = loadMessages('user-a');
    expect(loaded[0].isStreaming).toBeUndefined();
    expect(loaded[0].content).toBe('途中');
  });

  it('エラー情報は復元する', () => {
    saveMessages('user-a', [
      { id: 'm1', role: 'assistant', content: '', error: '失敗しました' },
    ]);

    expect(loadMessages('user-a')[0].error).toBe('失敗しました');
  });

  it('上限を超えた分は古いものから捨てる', () => {
    const many = Array.from({ length: MAX_STORED_MESSAGES + 10 }, (_, i) =>
      message(`m${i}`, `発言${i}`),
    );
    saveMessages('user-a', many);

    const loaded = loadMessages('user-a');
    expect(loaded).toHaveLength(MAX_STORED_MESSAGES);
    // 直近のものが残っていること
    expect(loaded[loaded.length - 1].content).toBe(
      `発言${MAX_STORED_MESSAGES + 9}`,
    );
  });

  it('壊れたデータが入っていても空配列で復帰する', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('sakekasu:sommelier-chat:user-a', '{壊れたJSON');

    expect(loadMessages('user-a')).toEqual([]);
    vi.mocked(console.error).mockRestore();
  });

  it('想定外の形の要素は取り除く', () => {
    localStorage.setItem(
      'sakekasu:sommelier-chat:user-a',
      JSON.stringify([{ id: 'ok', role: 'user', content: '正常' }, null, 42, { role: 'user' }]),
    );

    expect(loadMessages('user-a')).toEqual([
      { id: 'ok', role: 'user', content: '正常', error: undefined },
    ]);
  });

  it('添付画像の dataURL は保存せず、枚数だけ復元する', () => {
    saveMessages('user-a', [
      {
        id: 'm1',
        role: 'user',
        content: 'この中でおすすめある？',
        images: ['data:image/jpeg;base64,xxxx', 'data:image/png;base64,yyyy'],
        imageCount: 2,
      },
    ]);

    // localStorage に画像の実体が入っていないこと（容量を食い潰さない）
    const raw = localStorage.getItem('sakekasu:sommelier-chat:user-a') ?? '';
    expect(raw).not.toContain('data:image');

    const loaded = loadMessages('user-a');
    expect(loaded[0].images).toBeUndefined();
    expect(loaded[0].imageCount).toBe(2);
  });

  it('imageCount がなくても images の枚数から補完して保存する', () => {
    saveMessages('user-a', [
      {
        id: 'm1',
        role: 'user',
        content: '',
        images: ['data:image/jpeg;base64,xxxx'],
      },
    ]);

    expect(loadMessages('user-a')[0].imageCount).toBe(1);
  });

  it('削除すると履歴が空になる', () => {
    saveMessages('user-a', [message('m1', '相談')]);
    clearMessages('user-a');

    expect(loadMessages('user-a')).toEqual([]);
  });

  // 応答の保存は受信し終えてから行うので、サインアウトや「新しい相談」の
  // 後始末と競合する。始めた時点の世代を控えておいて、その後に消されて
  // いたら書き戻さない
  it('保存を始めた後に消されていたら書き戻さない', () => {
    const writeToken = beginMessagesWrite();
    clearMessages('user-a');

    saveMessages('user-a', [message('m1', '消したはずの相談')], writeToken);

    expect(localStorage.getItem('sakekasu:sommelier-chat:user-a')).toBeNull();
  });

  it('消した後に始めた保存は書き戻す（次の会話まで止めない）', () => {
    clearMessages('user-a');
    const writeToken = beginMessagesWrite();

    saveMessages('user-a', [message('m1', '新しい相談')], writeToken);

    expect(loadMessages('user-a')).toHaveLength(1);
  });

  it('他のユーザーを消しても、こちらの保存は止めない', () => {
    const writeToken = beginMessagesWrite();
    clearMessages('user-b');

    saveMessages('user-a', [message('m1', '相談')], writeToken);

    expect(loadMessages('user-a')).toHaveLength(1);
  });
});

// 会話の文脈はエージェント側の記憶にあり、セッション ID が唯一の手がかり。
// これを取り違えると、画面に見えている会話と文脈がずれる
describe('相談セッションの保存', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('保存したセッション ID を読み戻せる', () => {
    const sessionId = createSessionId();
    saveSessionId('user-a', sessionId);

    expect(loadSessionId('user-a')).toBe(sessionId);
  });

  it('作るたびに違う ID になり、AgentCore の長さの要求を満たす', () => {
    const first = createSessionId();

    expect(first).not.toBe(createSessionId());
    expect(first.length).toBeGreaterThanOrEqual(33);
  });

  it('ユーザーごとに分かれる（他人の会話の続きにならない）', () => {
    saveSessionId('user-a', createSessionId());

    expect(loadSessionId('user-b')).toBeNull();
  });

  it('保存がなければ null を返す', () => {
    expect(loadSessionId('user-a')).toBeNull();
  });

  it('userId が空なら保存も読み込みもしない', () => {
    saveSessionId('', createSessionId());

    expect(loadSessionId('')).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it.each([
    ['短すぎる値', 'too-short'],
    ['エージェント側が受け付けない文字', `セッション${'a'.repeat(40)}`],
    ['区切り文字を含む値', `../other${'a'.repeat(40)}`],
    ['長すぎる値', 'a'.repeat(101)],
  ])('端末の値が書き換えられていたら使わない（%s）', (_label, stored) => {
    localStorage.setItem('sakekasu:sommelier-session:user-a', stored);

    expect(loadSessionId('user-a')).toBeNull();
  });

  // 読む側だけで検査していると、端末には何でも置ける一方で読めるのは
  // 正しい形の値だけ、という非対称ができる。その隙間は「読めてしまう形の値を
  // 仕込む」ことに使えるので、書く側でも同じ検査を通す
  it.each([
    ['短すぎる値', 'too-short'],
    ['使えない文字を含む値', `セッション${'a'.repeat(40)}`],
    ['改行を含む値', `abc${'a'.repeat(40)}\r\nX-Injected: 1`],
    ['長すぎる値', 'a'.repeat(101)],
  ])('形式の合わない値は保存しない（%s）', (_label, sessionId) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    saveSessionId('user-a', sessionId);

    expect(localStorage.getItem('sakekasu:sommelier-session:user-a')).toBeNull();
    vi.mocked(console.error).mockRestore();
  });

  it('削除するとセッションが引き継がれなくなる', () => {
    saveSessionId('user-a', createSessionId());
    clearSessionId('user-a');

    expect(loadSessionId('user-a')).toBeNull();
  });
});
