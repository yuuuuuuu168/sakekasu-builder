import { useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { ImagePlus, X } from 'lucide-react';
import { ChatMessageList } from './ChatMessageList';
import {
  MAX_CHAT_IMAGES,
  prepareChatImage,
  type PreparedChatImage,
} from '../lib/chatImages';
import type { ChatMessage } from '../types';

/** 1回の相談で送れる最大文字数（エージェント側の上限と揃える） */
const MAX_PROMPT_LENGTH = 4000;

interface ChatWindowProps {
  messages: ChatMessage[];
  isResponding: boolean;
  onSend: (prompt: string, images: PreparedChatImage[]) => void;
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
  const [attachments, setAttachments] = useState<PreparedChatImage[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  // 圧縮・変換中の送信を防ぐ（変換前の状態で送ってしまわないように）
  const [isPreparing, setIsPreparing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 写真だけの相談（「この中でおすすめある？」を写真が語る）も送れるようにする
  const canSend =
    (input.trim().length > 0 || attachments.length > 0) &&
    !isResponding &&
    !isPreparing;

  const submit = () => {
    if (!canSend) return;
    onSend(input, attachments);
    setInput('');
    setAttachments([]);
    setAttachError(null);
  };

  const handleFilesSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // 同じファイルをもう一度選んでも change が発火するようにリセットする
    e.target.value = '';
    if (files.length === 0) return;

    setAttachError(null);
    const room = MAX_CHAT_IMAGES - attachments.length;
    if (files.length > room) {
      setAttachError(`画像は${MAX_CHAT_IMAGES}枚まで添付できます`);
    }

    setIsPreparing(true);
    try {
      const prepared: PreparedChatImage[] = [];
      for (const file of files.slice(0, Math.max(0, room))) {
        prepared.push(await prepareChatImage(file));
      }
      setAttachments((prev) =>
        [...prev, ...prepared].slice(0, MAX_CHAT_IMAGES),
      );
    } catch (err) {
      setAttachError(
        err instanceof Error ? err.message : '画像を読み込めませんでした',
      );
    } finally {
      setIsPreparing(false);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    setAttachError(null);
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
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      role="dialog"
      aria-label="酒ソムリエとの相談"
      // dvh を使うのは、iOS でアドレスバーの出入りにより vh がずれるため
      className="fixed bottom-20 right-4 z-50 flex h-[70dvh] max-h-[560px] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl sm:right-6"
      data-testid="sommelier-chat-window"
    >
      {/* ヘッダー */}
      <div className="flex items-center justify-between border-b border-border py-2 pr-2 pl-4">
        <h2 className="text-sm font-bold text-foreground">
          酒ソムリエ
        </h2>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={onReset}
              className="rounded px-2 py-1 text-xs text-ink-2 transition-colors hover:bg-muted hover:text-foreground"
              data-testid="chat-reset"
            >
              新しい相談
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="flex size-8 items-center justify-center rounded text-ink-2 transition-colors hover:bg-muted hover:text-foreground"
            data-testid="chat-close"
          >
            <X className="size-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      </div>

      <ChatMessageList messages={messages} />

      {/* 入力欄 */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-border p-2"
      >
        {/* 添付画像のプレビュー */}
        {attachments.length > 0 && (
          <div className="mb-2 flex gap-2" data-testid="chat-attachments">
            {attachments.map((image, index) => (
              <div key={`${index}-${image.data.slice(0, 16)}`} className="relative">
                <img
                  src={image.dataUrl}
                  alt={`添付画像${index + 1}`}
                  className="h-14 w-14 rounded-lg border border-border object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeAttachment(index)}
                  aria-label={`添付画像${index + 1}を削除`}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background shadow-sm transition-colors hover:bg-ink-2"
                  data-testid={`chat-attachment-remove-${index}`}
                >
                  <X className="size-3" strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
        {attachError && (
          <p
            className="mb-1 text-xs text-danger"
            data-testid="chat-attach-error"
          >
            {attachError}
          </p>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            multiple
            onChange={handleFilesSelected}
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
            data-testid="chat-image-input"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isPreparing || attachments.length >= MAX_CHAT_IMAGES}
            aria-label="写真を添付"
            title="酒屋の棚やメニューの写真からおすすめを聞けます"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
            data-testid="chat-attach"
          >
            <ImagePlus className="size-[18px]" strokeWidth={1.5} aria-hidden="true" />
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, MAX_PROMPT_LENGTH))}
            onKeyDown={handleKeyDown}
            rows={2}
            maxLength={MAX_PROMPT_LENGTH}
            placeholder="相談したいことを入力"
            aria-label="相談内容"
            // スマホでは 16px（text-base）にする。16px を下回ると iOS Safari が
            // 入力欄を触った拍子に画面を拡大し、そのまま戻らずに横へはみ出る
            className="min-h-[2.5rem] flex-1 resize-none rounded-lg border border-input bg-background px-2 py-1.5 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:text-sm"
            data-testid="chat-input"
          />
          {isResponding ? (
            <button
              type="button"
              onClick={onStop}
              className="shrink-0 rounded-lg bg-muted px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-border"
              data-testid="chat-stop"
            >
              停止
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              className="shrink-0 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
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
