import { useRef, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/** 圧縮情報（圧縮完了通知用） */
export interface CompressionInfo {
  originalSize: number;
  compressedSize: number;
}

export interface ImageUploadAreaProps {
  /** 選択された画像ファイル（後方互換: 単一） */
  imageFile: File | null;
  /** 選択された画像ファイル一覧 */
  imageFiles?: File[];
  /** 画像ファイル変更時のコールバック（後方互換: 単一追加） */
  onImageChange: (file: File | null) => void;
  /** 特定の画像を削除 */
  onImageRemove?: (index: number) => void;
  /** 圧縮中フラグ */
  isCompressing: boolean;
  /** アップロード中フラグ */
  isUploading?: boolean;
  /** エラーメッセージ */
  error: string | null;
  /** 圧縮完了情報 */
  compressionInfo?: CompressionInfo | null;
  /** 無効化フラグ */
  disabled?: boolean;
  /** OCR 解析中フラグ */
  isOcrAnalyzing?: boolean;
  /** OCR トリガーボタンのクリックハンドラ */
  onOcrTrigger?: () => void;
  /** OCR 結果メッセージ（成功/エラー） */
  ocrMessage?: { text: string; variant: 'success' | 'error' } | null;
  /** 最大画像数 */
  maxImages?: number;
}

function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2);
}

export function ImageUploadArea({
  imageFile,
  imageFiles: imageFilesProp,
  onImageChange,
  onImageRemove,
  isCompressing,
  isUploading = false,
  error,
  compressionInfo = null,
  disabled = false,
  isOcrAnalyzing = false,
  onOcrTrigger,
  ocrMessage = null,
  maxImages = 5,
}: ImageUploadAreaProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // 複数画像対応: imageFiles prop があればそちらを使う、なければ imageFile から配列化
  const imageFiles = imageFilesProp ?? (imageFile ? [imageFile] : []);
  const hasImages = imageFiles.length > 0;
  const canAddMore = imageFiles.length < maxImages;

  const handleFileSelect = useCallback(
    (file: File) => {
      if (disabled) return;
      onImageChange(file);
    },
    [disabled, onImageChange],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      for (const file of files) {
        handleFileSelect(file);
      }
      e.target.value = '';
    },
    [handleFileSelect],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) setIsDragOver(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files || []);
      for (const file of files) {
        handleFileSelect(file);
      }
    },
    [disabled, handleFileSelect],
  );

  const handleDelete = useCallback((index: number) => {
    if (onImageRemove) {
      onImageRemove(index);
    } else {
      onImageChange(null);
    }
  }, [onImageRemove, onImageChange]);

  const handleClick = useCallback(() => {
    if (!disabled && !isCompressing && !isUploading) {
      inputRef.current?.click();
    }
  }, [disabled, isCompressing, isUploading]);

  const isInteractive = !disabled && !isCompressing && !isUploading && !isOcrAnalyzing;

  return (
    <div className="space-y-2" data-testid="image-upload-area">
      {/* 隠しファイル入力（multiple 対応） */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        className="hidden"
        onChange={handleInputChange}
        disabled={!isInteractive}
        data-testid="image-file-input"
      />

      {/* プレビュー一覧 */}
      {hasImages && (
        <div className="flex flex-wrap gap-2">
          {imageFiles.map((file, index) => (
            <PreviewItem
              key={`${file.name}-${file.size}-${index}`}
              file={file}
              index={index}
              onDelete={() => handleDelete(index)}
              disabled={!isInteractive}
            />
          ))}

          {/* 追加ボタン */}
          {canAddMore && isInteractive && (
            <button
              type="button"
              onClick={handleClick}
              className="flex h-24 w-24 items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 text-muted-foreground/60 transition-colors hover:border-sake-gold/60 hover:text-sake-gold/60"
              aria-label="画像を追加"
              data-testid="image-add-button"
            >
              <PlusIcon />
            </button>
          )}
        </div>
      )}

      {/* OCR トリガーボタン（画像が1枚以上あるとき） */}
      {hasImages && onOcrTrigger && (
        <button
          type="button"
          onClick={onOcrTrigger}
          disabled={isOcrAnalyzing}
          className="flex items-center gap-1.5 rounded-md border border-sake-gold/40 bg-sake-gold/10 px-3 py-1.5 text-xs font-medium text-sake-gold transition-colors hover:bg-sake-gold/20 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="ocr-trigger-button"
        >
          {isOcrAnalyzing ? (
            <>
              <SpinnerIcon />
              <span>読み取り中...</span>
            </>
          ) : (
            <span>銘柄名を読み取る</span>
          )}
        </button>
      )}

      {/* ドロップゾーン（画像がないとき） */}
      {!hasImages && (
        <DropZone
          isDragOver={isDragOver}
          isInteractive={isInteractive}
          onClick={handleClick}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        />
      )}

      {/* 圧縮中メッセージ */}
      <AnimatePresence>
        {isCompressing && (
          <StatusMessage key="compressing" icon={<SpinnerIcon />} text="画像を圧縮中..." variant="info" />
        )}
      </AnimatePresence>

      {/* アップロード進捗 */}
      <AnimatePresence>
        {isUploading && (
          <StatusMessage key="uploading" icon={<SpinnerIcon />} text="画像をアップロード中..." variant="info" />
        )}
      </AnimatePresence>

      {/* 圧縮完了通知 */}
      <AnimatePresence>
        {compressionInfo && !isCompressing && (
          <StatusMessage
            key="compressed"
            icon={<CheckIcon />}
            text={`画像を圧縮しました（元: ${formatMB(compressionInfo.originalSize)}MB → ${formatMB(compressionInfo.compressedSize)}MB）`}
            variant="success"
          />
        )}
      </AnimatePresence>

      {/* エラーメッセージ */}
      <AnimatePresence>
        {error && <StatusMessage key="error" icon={<ErrorIcon />} text={error} variant="error" />}
      </AnimatePresence>

      {/* OCR 結果メッセージ */}
      <AnimatePresence>
        {ocrMessage && (
          <StatusMessage
            key="ocr-message"
            icon={ocrMessage.variant === 'success' ? <CheckIcon /> : <ErrorIcon />}
            text={ocrMessage.text}
            variant={ocrMessage.variant}
          />
        )}
      </AnimatePresence>

      {/* 画像枚数表示 */}
      {hasImages && (
        <p className="text-xs text-muted-foreground/70">
          {imageFiles.length}/{maxImages}枚
        </p>
      )}
    </div>
  );
}


/* ─── Sub-components ─── */

function DropZone({
  isDragOver,
  isInteractive,
  onClick,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  isDragOver: boolean;
  isInteractive: boolean;
  onClick: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={isInteractive ? 0 : -1}
      aria-label="画像を選択またはドラッグ＆ドロップ"
      className={`
        flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed
        px-4 py-6 text-center transition-colors
        ${isDragOver
          ? 'border-sake-gold bg-sake-gold/10'
          : 'border-muted-foreground/30 hover:border-sake-gold/60 hover:bg-muted/30'
        }
        ${!isInteractive ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
      `}
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      data-testid="image-drop-zone"
    >
      <CameraIcon />
      <p className="text-sm text-muted-foreground">
        画像を選択またはドラッグ＆ドロップ
      </p>
      <p className="text-xs text-muted-foreground/70">
        JPEG・PNG（最大5枚）
      </p>
    </div>
  );
}

function PreviewItem({
  file,
  index,
  onDelete,
  disabled,
}: {
  file: File;
  index: number;
  onDelete: () => void;
  disabled: boolean;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!previewUrl) return null;

  return (
    <motion.div
      className="relative inline-block"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      data-testid={`image-preview-${index}`}
    >
      <img
        src={previewUrl}
        alt={`選択された画像 ${index + 1}`}
        className="h-24 w-24 rounded-lg border border-border object-cover"
      />
      {!disabled && (
        <button
          type="button"
          onClick={onDelete}
          className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm transition-colors hover:bg-destructive/80"
          aria-label={`画像 ${index + 1} を削除`}
          data-testid={`image-delete-button-${index}`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </motion.div>
  );
}

function StatusMessage({
  icon,
  text,
  variant,
}: {
  icon: React.ReactNode;
  text: string;
  variant: 'info' | 'success' | 'error';
}) {
  const colorClass = {
    info: 'text-muted-foreground',
    success: 'text-green-600 dark:text-green-400',
    error: 'text-destructive',
  }[variant];

  return (
    <motion.div
      className={`flex items-center gap-1.5 text-xs ${colorClass}`}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      data-testid={`image-status-${variant}`}
    >
      {icon}
      <span>{text}</span>
    </motion.div>
  );
}

/* ─── Icons ─── */

function CameraIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-8 w-8 text-muted-foreground/60"
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
