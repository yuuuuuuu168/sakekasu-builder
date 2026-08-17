import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'test-user', email: 'a@example.com' } }),
}));

import { SommelierChat } from '../components/SommelierChat';
import { SommelierError } from '../lib/errors';
import type { SendToSommelier } from '../types';

/** 指定した文字列を1文字ずつ返す送信実装 */
function makeSend(reply: string): SendToSommelier {
  return async function* (_prompt, { signal }) {
    for (const char of reply) {
      if (signal.aborted) return;
      yield char;
    }
  };
}

/**
 * 必ず失敗する送信実装。
 * 何も yield せず throw するだけのジェネレータは require-yield に触れるため、
 * ここに集約して例外だけを差し替える
 */
function makeFailingSend(error: unknown): SendToSommelier {
  // eslint-disable-next-line require-yield
  return async function* () {
    throw error;
  };
}

/** 応答せず中断されるまで待ち続ける送信実装 */
const hangingSend: SendToSommelier = async function* (_prompt, { signal }) {
  yield '考え中';
  await new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    signal.addEventListener('abort', () => resolve());
  });
};

function openChat() {
  fireEvent.click(screen.getByTestId('sommelier-fab'));
}

describe('SommelierChat', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('初期状態ではボタンだけが表示される', () => {
    render(<SommelierChat send={makeSend('ok')} />);

    expect(screen.getByTestId('sommelier-fab')).toBeTruthy();
    expect(screen.queryByTestId('sommelier-chat-window')).toBeNull();
  });

  it('ボタンでチャットを開閉できる', async () => {
    render(<SommelierChat send={makeSend('ok')} />);

    openChat();
    expect(screen.getByTestId('sommelier-chat-window')).toBeTruthy();

    fireEvent.click(screen.getByTestId('chat-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('sommelier-chat-window')).toBeNull();
    });
  });

  it('会話がないときは案内を表示する', () => {
    render(<SommelierChat send={makeSend('ok')} />);
    openChat();

    expect(screen.getByTestId('chat-empty-state')).toBeTruthy();
  });

  it('送信すると自分の発言と応答が順に表示される', async () => {
    render(<SommelierChat send={makeSend('日本酒がおすすめです')} />);
    openChat();

    fireEvent.change(screen.getByTestId('chat-input'), {
      target: { value: '今夜のおすすめは？' },
    });
    fireEvent.click(screen.getByTestId('chat-send'));

    expect(await screen.findByText('今夜のおすすめは？')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('日本酒がおすすめです')).toBeTruthy();
    });
  });

  it('送信後に入力欄が空になる', async () => {
    render(<SommelierChat send={makeSend('ok')} />);
    openChat();

    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'テスト' } });
    fireEvent.click(screen.getByTestId('chat-send'));

    await waitFor(() => expect(input.value).toBe(''));
  });

  it('空欄では送信できない', () => {
    render(<SommelierChat send={makeSend('ok')} />);
    openChat();

    const button = screen.getByTestId('chat-send') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByTestId('chat-input'), {
      target: { value: '   ' },
    });
    expect(button.disabled).toBe(true);
  });

  it('Enter で送信し、Shift+Enter では送信しない', async () => {
    const send = vi.fn(makeSend('ok'));
    render(<SommelierChat send={send} />);
    openChat();

    const input = screen.getByTestId('chat-input');
    fireEvent.change(input, { target: { value: '相談' } });

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(send).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  });

  it('日本語変換中の Enter では送信しない', () => {
    const send = vi.fn(makeSend('ok'));
    render(<SommelierChat send={send} />);
    openChat();

    const input = screen.getByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'にほんしゅ' } });
    // 変換確定の Enter は isComposing が true で届く
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });

    expect(send).not.toHaveBeenCalled();
  });

  it('応答中は停止ボタンを出し、押すと受信を打ち切る', async () => {
    render(<SommelierChat send={hangingSend} />);
    openChat();

    fireEvent.change(screen.getByTestId('chat-input'), {
      target: { value: '長い相談' },
    });
    fireEvent.click(screen.getByTestId('chat-send'));

    const stopButton = await screen.findByTestId('chat-stop');
    fireEvent.click(stopButton);

    await waitFor(() => {
      expect(screen.getByTestId('chat-send')).toBeTruthy();
    });
  });

  it('応答が失敗したらエラーを表示する', async () => {
    const failing = makeFailingSend(new Error('network error'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<SommelierChat send={failing} />);
    openChat();

    fireEvent.change(screen.getByTestId('chat-input'), {
      target: { value: '相談' },
    });
    fireEvent.click(screen.getByTestId('chat-send'));

    expect(await screen.findByTestId('chat-error')).toBeTruthy();
    vi.mocked(console.error).mockRestore();
  });

  it('中断で AbortError が投げられてもエラーとして表示しない', async () => {
    // 実際の runtimeSend は abort されると fetch が AbortError を投げる
    const abortingSend: SendToSommelier = async function* (_prompt, { signal }) {
      yield '考え';
      await new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        signal.addEventListener('abort', () => resolve());
      });
      throw new DOMException('中断されました', 'AbortError');
    };

    render(<SommelierChat send={abortingSend} />);
    openChat();

    fireEvent.change(screen.getByTestId('chat-input'), {
      target: { value: '長い相談' },
    });
    fireEvent.click(screen.getByTestId('chat-send'));

    fireEvent.click(await screen.findByTestId('chat-stop'));

    await waitFor(() => {
      expect(screen.getByTestId('chat-send')).toBeTruthy();
    });
    // 自分で止めただけなので、受信済みの内容を残して静かに終わる
    expect(screen.queryByTestId('chat-error')).toBeNull();
    expect(screen.getByText(/考え/)).toBeTruthy();
  });

  it('認証切れは再サインインを促す文言を出す', async () => {
    const failing = makeFailingSend(new SommelierError('auth', '内部メッセージ'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<SommelierChat send={failing} />);
    openChat();

    fireEvent.change(screen.getByTestId('chat-input'), {
      target: { value: '相談' },
    });
    fireEvent.click(screen.getByTestId('chat-send'));

    const error = await screen.findByTestId('chat-error');
    expect(error.textContent).toContain('サインイン');
    // 内部メッセージは画面に出さない
    expect(error.textContent).not.toContain('内部メッセージ');
    vi.mocked(console.error).mockRestore();
  });

  it('通信断は接続の確認を促す文言を出す', async () => {
    const failing = makeFailingSend(new TypeError('Failed to fetch'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<SommelierChat send={failing} />);
    openChat();

    fireEvent.change(screen.getByTestId('chat-input'), {
      target: { value: '相談' },
    });
    fireEvent.click(screen.getByTestId('chat-send'));

    // 種類の判別は runtimeSend が行うため、素の TypeError はここでは unknown 扱い
    expect((await screen.findByTestId('chat-error')).textContent).toContain(
      '応答の取得に失敗',
    );
    vi.mocked(console.error).mockRestore();
  });

  it('再マウント後も前回の会話が残っている（リロード相当）', async () => {
    const { unmount } = render(<SommelierChat send={makeSend('応答です')} />);
    openChat();

    fireEvent.change(screen.getByTestId('chat-input'), {
      target: { value: '前回の相談' },
    });
    fireEvent.click(screen.getByTestId('chat-send'));
    // 応答が完了すると停止ボタンが送信ボタンに戻る。保存はこの時点で行われる
    await waitFor(() => {
      expect(screen.getByText('応答です')).toBeTruthy();
      expect(screen.queryByTestId('chat-stop')).toBeNull();
    });

    unmount();

    render(<SommelierChat send={makeSend('別の応答')} />);
    openChat();

    expect(screen.getByText('前回の相談')).toBeTruthy();
    expect(screen.getByText('応答です')).toBeTruthy();
  });

  it('「新しい相談」の後は再マウントしても履歴が復活しない', async () => {
    const { unmount } = render(<SommelierChat send={makeSend('応答')} />);
    openChat();

    fireEvent.change(screen.getByTestId('chat-input'), {
      target: { value: '消える相談' },
    });
    fireEvent.click(screen.getByTestId('chat-send'));
    await screen.findByText('消える相談');

    fireEvent.click(screen.getByTestId('chat-reset'));
    await waitFor(() => {
      expect(screen.getByTestId('chat-empty-state')).toBeTruthy();
    });
    unmount();

    render(<SommelierChat send={makeSend('応答')} />);
    openChat();

    expect(screen.queryByText('消える相談')).toBeNull();
  });

  // エージェントは会話の文脈をセッション ID で引き当てる。画面に見えている
  // 会話と同じものを指し続けないと、続きのつもりの相談が文脈なしで届く
  describe('会話のセッション', () => {
    /** 送信のたびに渡されたセッション ID を控える送信実装 */
    function makeRecordingSend(sessionIds: string[]): SendToSommelier {
      // eslint-disable-next-line require-yield
      return async function* (_prompt, { sessionId }) {
        sessionIds.push(sessionId);
      };
    }

    async function send(text: string) {
      fireEvent.change(screen.getByTestId('chat-input'), {
        target: { value: text },
      });
      fireEvent.click(screen.getByTestId('chat-send'));
      await waitFor(() => {
        expect(screen.queryByTestId('chat-stop')).toBeNull();
      });
    }

    it('同じ会話の間は同じセッション ID で送る', async () => {
      const sessionIds: string[] = [];
      render(<SommelierChat send={makeRecordingSend(sessionIds)} />);
      openChat();

      await send('1回目');
      await send('2回目');

      expect(sessionIds).toHaveLength(2);
      expect(sessionIds[1]).toBe(sessionIds[0]);
    });

    it('再マウントしても同じセッションを引き継ぐ（リロード相当）', async () => {
      const sessionIds: string[] = [];
      const { unmount } = render(
        <SommelierChat send={makeRecordingSend(sessionIds)} />,
      );
      openChat();
      await send('前回の相談');
      unmount();

      render(<SommelierChat send={makeRecordingSend(sessionIds)} />);
      openChat();
      await send('続き');

      // 画面には前回の会話が残るので、文脈も同じ会話を指し続ける
      expect(sessionIds[1]).toBe(sessionIds[0]);
    });

    it('「新しい相談」の後は別のセッションで送る', async () => {
      const sessionIds: string[] = [];
      render(<SommelierChat send={makeRecordingSend(sessionIds)} />);
      openChat();
      await send('前の相談');

      fireEvent.click(screen.getByTestId('chat-reset'));
      await waitFor(() => {
        expect(screen.getByTestId('chat-empty-state')).toBeTruthy();
      });
      await send('新しい相談');

      expect(sessionIds[1]).not.toBe(sessionIds[0]);
    });
  });

  it('「新しい相談」で会話を破棄できる', async () => {
    render(<SommelierChat send={makeSend('応答')} />);
    openChat();

    fireEvent.change(screen.getByTestId('chat-input'), {
      target: { value: '相談' },
    });
    fireEvent.click(screen.getByTestId('chat-send'));
    await screen.findByText('相談');

    fireEvent.click(screen.getByTestId('chat-reset'));

    await waitFor(() => {
      expect(screen.getByTestId('chat-empty-state')).toBeTruthy();
    });
  });
});
