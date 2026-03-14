import { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

export interface ImageModalProps {
  /** モーダル表示状態 */
  open: boolean;
  /** 表示状態変更コールバック */
  onOpenChange: (open: boolean) => void;
  /** 画像の Presigned URL */
  imageUrl: string;
  /** 銘柄名（alt テキスト用） */
  sakeName: string;
}

export function ImageModal({
  open,
  onOpenChange,
  imageUrl,
  sakeName,
}: ImageModalProps) {
  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  // Escape キーで閉じる
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    // モーダル表示中はスクロールを無効化
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, handleClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          data-testid="image-modal"
        >
          {/* オーバーレイ */}
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleClose}
            data-testid="image-modal-overlay"
            aria-hidden="true"
          />

          {/* モーダルコンテンツ */}
          <motion.div
            className="relative z-10 max-h-[90vh] max-w-[90vw]"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            role="dialog"
            aria-modal="true"
            aria-label={`${sakeName}の画像`}
          >
            {/* 閉じるボタン */}
            <button
              type="button"
              onClick={handleClose}
              className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-background/90 text-foreground shadow-lg transition-colors hover:bg-background"
              aria-label="閉じる"
              data-testid="image-modal-close"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            {/* 画像 */}
            <img
              src={imageUrl}
              alt={`${sakeName}の画像`}
              className="max-h-[85vh] max-w-[85vw] rounded-lg object-contain shadow-2xl"
              data-testid="image-modal-image"
            />
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
