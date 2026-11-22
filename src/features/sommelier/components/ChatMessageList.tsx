import { useEffect, useRef } from 'react';
import { ImageIcon } from 'lucide-react';
import { linkifyText } from '../lib/linkify';
import type { ChatMessage } from '../types';

interface ChatMessageListProps {
  messages: ChatMessage[];
}

const SUGGESTIONS = [
  '今夜は寒いから温めて飲みたい',
  '今夜すき焼きなんだけど何が合う？',
  '星4だったあの酒が好きなら次は何？',
  '獺祭ってどんなお酒？',
  '（棚の写真を添付して）この中でおすすめある？',
];

/** 会話が空のときに出す案内 */
function EmptyState() {
  return (
    <div className="flex h-full flex-col justify-center gap-3 px-4">
      <p className="text-sm text-ink-2">
        在庫の相談、料理との組み合わせ、銘柄選び、お酒の知識まで聞けます。話すうちに好みも覚えます。
      </p>
      <ul className="space-y-1 text-xs text-muted-foreground">
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
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                isUser
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
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
                <p
                  className="mb-1 flex items-center gap-1 text-xs opacity-80"
                  data-testid="chat-message-image-count"
                >
                  <ImageIcon className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                  画像{message.imageCount}枚を添付
                </p>
              ) : null}
              {/* ソムリエは出典の URL を本文に載せるので、開ける形にする。
                  ユーザーの発話はそのまま出す（リンクにする理由がない） */}
              {isUser ? message.content : linkifyText(message.content)}
              {/* 最初の文字が届くまでは、固まって見えないよう「考え中」を出す */}
              {message.isStreaming && !message.content && (
                <span className="text-muted-foreground" data-testid="chat-thinking">
                  考え中
                </span>
              )}
              {message.isStreaming && (
                <span
                  className="ml-0.5 inline-block animate-pulse" /* check-ui-ignore: 生成中だけ出す本文のカーソル */
                  data-testid="streaming-cursor"
                  aria-hidden="true"
                >
                  ▌
                </span>
              )}
              {message.error && (
                <p
                  className="mt-1 text-xs text-danger"
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
