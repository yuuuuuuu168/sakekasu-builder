import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useImageUrls } from '../hooks/useImageUrls';

export interface ImageModalProps {
  /** モーダル表示状態 */
  open: boolean;
  /** 表示状態変更コールバック */
  onOpenChange: (open: boolean) => void;
  /** 画像の imageKeys 配列 */
  imageKeys: string[];
  /** 初期表示インデックス */
  initialIndex?: number;
  /** 銘柄名（alt テキスト用） */
  sakeName: string;
}

export function ImageModal({
  open,
  onOpenChange,
  imageKeys,
  initialIndex = 0,
  sakeName,
}: ImageModalProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const { imageUrls, isLoading } = useImageUrls(open ? imageKeys : []);
  const total = imageKeys.length;

  // initialIndex が変わったらリセット
  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handlePrev = useCallback(() => {
    setCurrentIndex((i) => (i > 0 ? i - 1 : total - 1));
  }, [total]);

  const handleNext = useCallback(() => {
    setCurrentIndex((i) => (i < total - 1 ? i + 1 : 0));
  }, [total]);

  // キーボード操作
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, handleClose, handlePrev, handleNext]);

  const currentUrl = imageUrls[currentIndex] ?? null;

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
            className="relative z-10 flex max-h-[90vh] max-w-[90vw] flex-col items-center"
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
              className="absolute -right-3 -top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-background/90 text-foreground shadow-lg transition-colors hover:bg-background"
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
            {isLoading || !currentUrl ? (
              <div className="flex h-64 w-64 items-center justify-center rounded-lg bg-gray-800/50">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              </div>
            ) : (
              <img
                src={currentUrl}
                alt={`${sakeName}の画像 (${currentIndex + 1}/${total})`}
                className="max-h-[85vh] max-w-[85vw] rounded-lg object-contain shadow-2xl"
                data-testid="image-modal-image"
              />
            )}

            {/* ナビゲーション（複数画像の場合のみ） */}
            {total > 1 && (
              <>
                {/* 前へボタン */}
                <button
                  type="button"
                  onClick={handlePrev}
                  className="absolute left-[-48px] top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-background/80 text-foreground shadow-lg transition-colors hover:bg-background"
                  aria-label="前の画像"
                  data-testid="image-modal-prev"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>

                {/* 次へボタン */}
                <button
                  type="button"
                  onClick={handleNext}
                  className="absolute right-[-48px] top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-background/80 text-foreground shadow-lg transition-colors hover:bg-background"
                  aria-label="次の画像"
                  data-testid="image-modal-next"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>

                {/* インジケーター */}
                <div className="mt-3 flex gap-1.5" data-testid="image-modal-indicators">
                  {imageKeys.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setCurrentIndex(i)}
                      className={`h-2 w-2 rounded-full transition-all ${
                        i === currentIndex
                          ? 'scale-125 bg-white'
                          : 'bg-white/40 hover:bg-white/60'
                      }`}
                      aria-label={`画像 ${i + 1}`}
                    />
                  ))}
                </div>
              </>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
