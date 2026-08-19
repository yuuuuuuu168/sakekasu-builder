import { useEffect, useRef } from 'react';
import { linkifyText } from '../lib/linkify';
import type { ChatMessage } from '../types';

interface ChatMessageListProps {
  messages: ChatMessage[];
}

const SUGGESTIONS = [
  '今夜は寒いから温めて飲みたい',
  '今夜すき焼きなんだけど何が合う？',
  '★4だったあの酒が好きなら次は何？',
  '獺祭ってどんなお酒？',
  '📷 棚の写真からこの中でおすすめある？',
];

/** 会話が空のときに出す案内 */
function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
      <span className="text-3xl" aria-hidden="true">
        🍶
      </span>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        在庫相談・料理とのペアリング・銘柄選び・お酒の知識まで相談できます。
        話すうちに好みも覚えます
      </p>
      <ul className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
        {SUGGESTIONS.map((s) => (
          <li key={s}>「{s}」</li>
        ))}
      </ul>
    </div>
  );
}

export function ChatMessageList({ messages }: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // 新しい発言や受信中の追記に合わせて最下部へ追従する
  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto" data-testid="chat-empty-state">
        <EmptyState />
      </div>
    );
  }

  return (
    <div
      className="flex-1 space-y-3 overflow-y-auto px-3 py-3"
      role="log"
      aria-live="polite"
      aria-label="ソムリエとの会話"
      data-testid="chat-messages"
    >
      {messages.map((message) => {
        const isUser = message.role === 'user';
        return (
          <div
            key={message.id}
            className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
            data-testid={`chat-message-${message.role}`}
          >
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                isUser
                  ? 'bg-gold-wa text-white dark:bg-dark-gold dark:text-gray-900'
                  : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
              }`}
            >
              {message.images && message.images.length > 0 && (
                <div
                  className="mb-1 flex flex-wrap gap-1"
                  data-testid="chat-message-images"
                >
                  {message.images.map((src, index) => (
                    <img
                      key={`${message.id}-img-${index}`}
                      src={src}
                      alt={`添付画像${index + 1}`}
                      className="h-24 w-24 rounded-lg object-cover"
                    />
                  ))}
                </div>
              )}
              {/* 復元した履歴は画像の実体を持たないため、枚数だけ示す */}
              {!message.images?.length && message.imageCount ? (
                <p className="mb-1 text-xs opacity-80" data-testid="chat-message-image-count">
                  📷 画像{message.imageCount}枚を添付
                </p>
              ) : null}
              {/* ソムリエは出典の URL を本文に載せるので、開ける形にする。
                  ユーザーの発話はそのまま出す（リンクにする理由がない） */}
              {isUser ? message.content : linkifyText(message.content)}
              {message.isStreaming && (
                <span
                  className="ml-0.5 inline-block animate-pulse"
                  data-testid="streaming-cursor"
                  aria-hidden="true"
                >
                  ▌
                </span>
              )}
              {message.error && (
                <p
                  className="mt-1 text-xs text-red-600 dark:text-red-400"
                  data-testid="chat-error"
                >
                  {message.error}
                </p>
              )}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
