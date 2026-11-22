import { MessageCircle, X } from 'lucide-react';

interface FloatingChatButtonProps {
  isOpen: boolean;
  onClick: () => void;
}

/** 画面右下に常駐する、ソムリエ相談の開閉ボタン */
export function FloatingChatButton({ isOpen, onClick }: FloatingChatButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isOpen ? 'ソムリエ相談を閉じる' : 'ソムリエに相談する'}
      aria-expanded={isOpen}
      className="fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-colors hover:bg-primary-hover active:scale-[0.97] sm:right-6"
      data-testid="sommelier-fab"
    >
      {isOpen ? (
        <X className="size-6" strokeWidth={1.5} aria-hidden="true" />
      ) : (
        <MessageCircle className="size-6" strokeWidth={1.5} aria-hidden="true" />
      )}
    </button>
  );
}
