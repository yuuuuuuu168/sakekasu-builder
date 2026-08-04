import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, SendToSommelier } from '../types';
import { clearMessages, loadMessages, saveMessages } from '../lib/chatStorage';

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
export function useSommelierChat(
  send: SendToSommelier,
  userId: string,
): UseSommelierChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isResponding, setIsResponding] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  /**
   * 最新の発言一覧。保存は「状態を監視するエフェクト」ではなく
   * 会話が確定した時点で明示的に行う。エフェクト任せにすると、
   * リセット直後に古い状態のエフェクトが走って履歴が復活しうる。
   */
  const messagesRef = useRef<ChatMessage[]>([]);

  /**
   * 発言一覧を更新する。更新関数は setState の中ではなくここで即時に評価し、
   * ref を常に最新に保つ（保存時に確実に最新の内容を書けるようにするため）。
   * 発言を変更するのはこのフックだけなので ref を基準にして問題ない。
   */
  const applyMessages = useCallback(
    (update: (prev: ChatMessage[]) => ChatMessage[]) => {
      const next = update(messagesRef.current);
      messagesRef.current = next;
      setMessages(next);
    },
    [],
  );

  // 保存済みの履歴を読み込む。ユーザーが変わったら読み直す
  useEffect(() => {
    const stored = loadMessages(userId);
    messagesRef.current = stored;
    setMessages(stored);
  }, [userId]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const reset = useCallback(() => {
    stop();
    messagesRef.current = [];
    setMessages([]);
    setIsResponding(false);
    clearMessages(userId);
  }, [stop, userId]);

  const sendMessage = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed || isResponding) return;

      // 今回の発言を積む前の会話を、文脈として送る
      const history = messagesRef.current;

      const assistantId = createId('assistant');
      applyMessages((prev) => [
        ...prev,
        { id: createId('user'), role: 'user', content: trimmed },
        { id: assistantId, role: 'assistant', content: '', isStreaming: true },
      ]);
      setIsResponding(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const updateAssistant = (update: Partial<ChatMessage>) => {
        applyMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, ...update } : m)),
        );
      };

      try {
        let content = '';
        for await (const chunk of send(trimmed, {
          signal: controller.signal,
          history,
        })) {
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
        // 会話が確定した時点で保存する。リセット後なら messagesRef は
        // 空になっているため、消した履歴が書き戻ることはない
        saveMessages(userId, messagesRef.current);
      }
    },
    [send, isResponding, applyMessages, userId],
  );

  return { messages, isResponding, sendMessage, stop, reset };
}
