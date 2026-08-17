import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, SendToSommelier } from '../types';
import type { PreparedChatImage } from '../lib/chatImages';
import {
  beginMessagesWrite,
  clearMessages,
  clearSessionId,
  loadMessages,
  loadSessionId,
  saveMessages,
  saveSessionId,
} from '../lib/chatStorage';
import { createSessionId } from '../lib/sessionId';
import { SommelierError, isAbortError, messageForError } from '../lib/errors';

export interface UseSommelierChatReturn {
  messages: ChatMessage[];
  /** 応答待ちかどうか */
  isResponding: boolean;
  sendMessage: (prompt: string, images?: PreparedChatImage[]) => Promise<void>;
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
   * いま続けている会話のセッション ID。
   * エージェントはこれを手がかりに自分の記憶から文脈を引き当てるので、
   * 画面に残っている会話と同じものを指し続ける必要がある。
   * 空文字は「まだ決まっていない」で、次の送信時に作る
   */
  const sessionIdRef = useRef('');

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

  // 表示用に保存しておいた会話を読み込む。ユーザーが変わったら読み直す。
  // セッション ID も一緒に引き継ぐ。画面だけ復元してセッションを作り直すと、
  // 目の前に前回の会話が見えているのにエージェントは文脈を持たない状態になる
  useEffect(() => {
    const stored = loadMessages(userId);
    messagesRef.current = stored;
    setMessages(stored);
    sessionIdRef.current = loadSessionId(userId) ?? '';

    // 受信中のままユーザーが変わったら（サインアウト）打ち切る。
    // 放っておくと、担当が外れた後もモデルを回し続けることになる
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [userId]);

  /** いまの会話のセッション ID を返す。まだ無ければ作って端末にも残す */
  const currentSessionId = useCallback(() => {
    if (!sessionIdRef.current) {
      sessionIdRef.current = createSessionId();
      saveSessionId(userId, sessionIdRef.current);
    }
    return sessionIdRef.current;
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
    // 「新しい相談」はエージェント側の文脈も切る。セッションを捨てておけば、
    // 次の送信で新しい ID が作られ、前の会話は引き当てられなくなる
    sessionIdRef.current = '';
    clearSessionId(userId);
  }, [stop, userId]);

  const sendMessage = useCallback(
    async (prompt: string, images: PreparedChatImage[] = []) => {
      const trimmed = prompt.trim();
      // 写真だけの相談も許可する（「この中でおすすめある？」は文面がなくても成立する）
      if ((!trimmed && images.length === 0) || isResponding) return;

      // 送る前にセッションを確定させる。応答の途中で「新しい相談」を
      // 押されても、この送信は最後まで元の会話のものとして扱う
      const sessionId = currentSessionId();
      // 保存はこの応答を受け終えてから行う。その間にサインアウトや
      // 「新しい相談」で消されたかどうかを、確定時に判定できるようにする
      const writeToken = beginMessagesWrite();

      const userMessage: ChatMessage = {
        id: createId('user'),
        role: 'user',
        content: trimmed,
      };
      if (images.length > 0) {
        userMessage.images = images.map((image) => image.dataUrl);
        userMessage.imageCount = images.length;
      }

      const assistantId = createId('assistant');
      applyMessages((prev) => [
        ...prev,
        userMessage,
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
          sessionId,
          images:
            images.length > 0
              ? images.map(({ format, data }) => ({ format, data }))
              : undefined,
        })) {
          if (controller.signal.aborted) break;
          content += chunk;
          updateAssistant({ content });
        }
        updateAssistant({ isStreaming: false });
      } catch (err) {
        // 停止ボタンによる中断は失敗ではないので、そのまま受信済みの内容を残す
        if (isAbortError(err) || controller.signal.aborted) {
          updateAssistant({ isStreaming: false });
        } else {
          const kind = err instanceof SommelierError ? err.kind : 'unknown';
          // 種類を添えて出す。画面の文言だけでは切り分けられないため
          console.error(`ソムリエへの問い合わせに失敗しました [${kind}]:`, err);
          updateAssistant({
            isStreaming: false,
            error: messageForError(err),
          });
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        setIsResponding(false);
        // 会話が確定した時点で保存する。送信を始めた後に消されていれば
        // （サインアウト・「新しい相談」）、writeToken を見て書き戻さない
        saveMessages(userId, messagesRef.current, writeToken);
      }
    },
    [send, isResponding, applyMessages, currentSessionId, userId],
  );

  return { messages, isResponding, sendMessage, stop, reset };
}
