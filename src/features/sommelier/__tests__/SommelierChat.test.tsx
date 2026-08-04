import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SommelierChat } from '../components/SommelierChat';
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
    const failing: SendToSommelier = async function* () {
      throw new Error('network error');
    };
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
