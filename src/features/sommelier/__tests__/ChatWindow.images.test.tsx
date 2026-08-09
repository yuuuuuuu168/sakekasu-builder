import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { PreparedChatImage } from '../lib/chatImages';

const prepareChatImageMock = vi.fn();
vi.mock('../lib/chatImages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/chatImages')>();
  return {
    ...actual,
    prepareChatImage: (file: File) => prepareChatImageMock(file),
  };
});

const { ChatWindow } = await import('../components/ChatWindow');

const preparedImage: PreparedChatImage = {
  format: 'jpeg',
  data: 'ZGF0YQ==',
  dataUrl: 'data:image/jpeg;base64,ZGF0YQ==',
};

function renderWindow() {
  const onSend = vi.fn();
  render(
    <ChatWindow
      messages={[]}
      isResponding={false}
      onSend={onSend}
      onStop={vi.fn()}
      onReset={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  return onSend;
}

function selectFiles(files: File[]) {
  fireEvent.change(screen.getByTestId('chat-image-input'), {
    target: { files },
  });
}

const jpegFile = (name: string) =>
  new File(['x'], name, { type: 'image/jpeg' });

describe('ChatWindow の写真添付', () => {
  beforeEach(() => {
    prepareChatImageMock.mockReset();
    prepareChatImageMock.mockResolvedValue(preparedImage);
  });

  it('写真を選ぶとプレビューが表示され、文面なしでも送信できる', async () => {
    const onSend = renderWindow();

    selectFiles([jpegFile('tana.jpg')]);
    await waitFor(() => {
      expect(screen.getByTestId('chat-attachments')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('chat-send'));

    expect(onSend).toHaveBeenCalledWith('', [preparedImage]);
    // 送信後はプレビューが消える
    expect(screen.queryByTestId('chat-attachments')).toBeNull();
  });

  it('プレビューの削除ボタンで添付を取り消せる', async () => {
    renderWindow();

    selectFiles([jpegFile('tana.jpg')]);
    await waitFor(() => {
      expect(screen.getByTestId('chat-attachments')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('chat-attachment-remove-0'));

    expect(screen.queryByTestId('chat-attachments')).toBeNull();
    // 添付がなくなったので文面なしでは送信できない
    expect(
      (screen.getByTestId('chat-send') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('上限を超えた分は受け付けず、その旨を表示する', async () => {
    renderWindow();

    selectFiles([
      jpegFile('1.jpg'),
      jpegFile('2.jpg'),
      jpegFile('3.jpg'),
      jpegFile('4.jpg'),
    ]);

    await waitFor(() => {
      expect(screen.getByTestId('chat-attach-error').textContent).toContain(
        '3枚まで',
      );
    });
    // 上限の3枚だけ変換される
    expect(prepareChatImageMock).toHaveBeenCalledTimes(3);
  });

  it('変換に失敗したらエラーメッセージを表示し、添付には積まない', async () => {
    prepareChatImageMock.mockRejectedValue(
      new Error('JPEG または PNG 形式の画像を選択してください'),
    );
    renderWindow();

    selectFiles([jpegFile('bad.jpg')]);

    await waitFor(() => {
      expect(screen.getByTestId('chat-attach-error').textContent).toContain(
        'JPEG または PNG',
      );
    });
    expect(screen.queryByTestId('chat-attachments')).toBeNull();
  });
});
