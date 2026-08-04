import { useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { ChatMessageList } from './ChatMessageList';
import type { ChatMessage } from '../types';

/** 1回の相談で送れる最大文字数（エージェント側の上限と揃える） */
const MAX_PROMPT_LENGTH = 4000;

interface ChatWindowProps {
  messages: ChatMessage[];
  isResponding: boolean;
  onSend: (prompt: string) => void;
  onStop: () => void;
  onReset: () => void;
  onClose: () => void;
}

export function ChatWindow({
  messages,
  isResponding,
  onSend,
  onStop,
  onReset,
  onClose,
}: ChatWindowProps) {
  const [input, setInput] = useState('');

  const canSend = input.trim().length > 0 && !isResponding;

  const submit = () => {
    if (!canSend) return;
    onSend(input);
    setInput('');
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  // 日本語入力の変換確定と送信が衝突しないよう、変換中は送信しない
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.98 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      role="dialog"
      aria-label="酒ソムリエとの相談"
      // dvh を使うのは、iOS でアドレスバーの出入りにより vh がずれるため
      className="fixed bottom-20 right-4 z-50 flex h-[70dvh] max-h-[560px] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl dark:border-white/10 dark:bg-dark-bg sm:right-6"
      data-testid="sommelier-chat-window"
    >
      {/* ヘッダー */}
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-white/10">
        <h2 className="text-sm font-bold text-indigo-wa dark:text-dark-gold">
          🍶 酒ソムリエ
        </h2>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={onReset}
              className="rounded px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-200"
              data-testid="chat-reset"
            >
              新しい相談
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded px-2 py-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-200"
            data-testid="chat-close"
          >
            ✕
          </button>
        </div>
      </div>

      <ChatMessageList messages={messages} />

      {/* 入力欄 */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-gray-200 p-2 dark:border-white/10"
      >
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, MAX_PROMPT_LENGTH))}
            onKeyDown={handleKeyDown}
            rows={2}
            maxLength={MAX_PROMPT_LENGTH}
            placeholder="今夜は何を飲もう？"
            aria-label="相談内容"
            className="min-h-[2.5rem] flex-1 resize-none rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-sake-gold focus:ring-1 focus:ring-sake-gold/40 dark:border-white/15 dark:bg-white/5 dark:text-gray-100"
            data-testid="chat-input"
          />
          {isResponding ? (
            <button
              type="button"
              onClick={onStop}
              className="shrink-0 rounded-lg bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-300 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20"
              data-testid="chat-stop"
            >
              停止
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              className="shrink-0 rounded-lg bg-gold-wa px-3 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40 dark:bg-dark-gold dark:text-gray-900"
              data-testid="chat-send"
            >
              送信
            </button>
          )}
        </div>
      </form>
    </motion.div>
  );
}
