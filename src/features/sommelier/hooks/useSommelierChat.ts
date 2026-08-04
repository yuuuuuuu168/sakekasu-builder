import { useCallback, useRef, useState } from 'react';
import type { ChatMessage, SendToSommelier } from '../types';

export interface UseSommelierChatReturn {
  messages: ChatMessage[];
  /** 応答待ちかどうか */
  isResponding: boolean;
  sendMessage: (prompt: string) => Promise<void>;
  /** 応答の受信を中断する */
  stop: () => void;
  /** 会話を破棄して最初からやり直す */
  reset: () => void;
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/**
 * ソムリエとの会話状態を管理する。
 *
 * 送信処理は引数で受け取るため、UI を変えずに呼び出し先を
 * 差し替えられる（ローカルのスタブ / AgentCore Runtime）。
 */
export function useSommelierChat(send: SendToSommelier): UseSommelierChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isResponding, setIsResponding] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const reset = useCallback(() => {
    stop();
    setMessages([]);
    setIsResponding(false);
  }, [stop]);

  const sendMessage = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed || isResponding) return;

      const assistantId = createId('assistant');
      setMessages((prev) => [
        ...prev,
        { id: createId('user'), role: 'user', content: trimmed },
        { id: assistantId, role: 'assistant', content: '', isStreaming: true },
      ]);
      setIsResponding(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const updateAssistant = (update: Partial<ChatMessage>) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, ...update } : m)),
        );
      };

      try {
        let content = '';
        for await (const chunk of send(trimmed, { signal: controller.signal })) {
          if (controller.signal.aborted) break;
          content += chunk;
          updateAssistant({ content });
        }
        updateAssistant({ isStreaming: false });
      } catch (err) {
        console.error('ソムリエへの問い合わせに失敗しました:', err);
        updateAssistant({
          isStreaming: false,
          error: '応答の取得に失敗しました。時間をおいてもう一度お試しください。',
        });
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        setIsResponding(false);
      }
    },
    [send, isResponding],
  );

  return { messages, isResponding, sendMessage, stop, reset };
}
