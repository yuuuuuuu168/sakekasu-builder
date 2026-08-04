import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../types';

interface ChatMessageListProps {
  messages: ChatMessage[];
}

const SUGGESTIONS = [
  '今夜は寒いから温めて飲みたい',
  '焼き鳥に合うお酒ある？',
  '開けたまま残ってるお酒は？',
];

/** 会話が空のときに出す案内 */
function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
      <span className="text-3xl" aria-hidden="true">
        🍶
      </span>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        手持ちのお酒から、今飲むならどれがいいか相談できます
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
              {message.content}
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
