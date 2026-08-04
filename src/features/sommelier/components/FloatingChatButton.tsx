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
      className="fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gold-wa text-2xl shadow-lg transition-transform hover:scale-105 active:scale-95 dark:bg-dark-gold sm:right-6"
      data-testid="sommelier-fab"
    >
      <span aria-hidden="true">{isOpen ? '✕' : '🍶'}</span>
    </button>
  );
}
