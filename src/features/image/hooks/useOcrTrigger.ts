import { useCallback, useEffect, useRef, useState } from 'react';
import { useOcrAnalysis } from './useOcrAnalysis';
import type { UseImageUploadReturn } from './useImageUpload';
import type { SakeCategory } from '@/features/purchase/types';
import { CATEGORY_DISPLAY_NAMES } from '@/components/form/CategorySelect';

export interface OcrMessage {
  text: string;
  variant: 'success' | 'error';
}

/** OCR で銘柄名が読み取れたときにフォームへ渡す検出結果 */
export interface OcrDetectedInfo {
  sakeName: string;
  category: SakeCategory | null;
  region: string | null;
  alcoholPercentage: number | null;
}

export interface OcrDetectedOptions {
  /** 画像追加を検知した自動実行か（true なら入力済みフィールドを上書きしない等の制御に使う） */
  isAuto: boolean;
}

/** 複数枚を連続で追加したときに1回の解析にまとめるための待ち時間 */
const AUTO_OCR_DEBOUNCE_MS = 1000;

/** 同一ファイルの再解析を防ぐための識別子 */
function fileSignature(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function useOcrTrigger(
  imageUpload: UseImageUploadReturn,
  recordType: 'purchase' | 'drinking',
  onOcrDetected: (info: OcrDetectedInfo, options: OcrDetectedOptions) => void,
) {
  const { analyzeImage, isAnalyzing, ocrResult, ocrError, resetOcr } = useOcrAnalysis();
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  // 解析済み（または解析を試みた）画像。自動実行の重複起動と失敗時の無限リトライを防ぐ
  const analyzedFilesRef = useRef<Set<string>>(new Set());

  const runOcr = async (isAuto: boolean) => {
    // 実行時点の全画像を解析済み扱いにする（失敗しても自動では再実行せず、再読み取りボタンに委ねる）
    for (const file of imageUpload.imageFiles ?? []) {
      analyzedFilesRef.current.add(fileSignature(file));
    }
    setHasAnalyzed(true);

    // 選択中の全画像（表・裏ラベルなど）をアップロードしてまとめて解析する
    const keys = await imageUpload.preUploadImages(recordType);
    if (keys.length === 0) return;
    const result = await analyzeImage(keys);
    if (result?.sakeName) {
      onOcrDetected(
        {
          sakeName: result.sakeName,
          category: result.category ?? null,
          region: result.region ?? null,
          alcoholPercentage: result.alcoholPercentage ?? null,
        },
        { isAuto },
      );
    }
  };

  const handleOcrTrigger = () => runOcr(false);

  // デバウンスタイマーから常に最新の state を参照するための ref
  const runOcrRef = useRef(runOcr);
  useEffect(() => {
    runOcrRef.current = runOcr;
  });

  const { imageFiles, isCompressing, isUploading } = imageUpload;

  // 画像追加の自動OCR: 未解析の画像があれば、圧縮・アップロード完了後に自動で解析する
  useEffect(() => {
    if (!imageFiles || imageFiles.length === 0) return;
    if (isCompressing || isUploading || isAnalyzing) return;
    const hasNewFile = imageFiles.some(
      (file) => !analyzedFilesRef.current.has(fileSignature(file)),
    );
    if (!hasNewFile) return;

    const timer = setTimeout(() => {
      runOcrRef.current(true);
    }, AUTO_OCR_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [imageFiles, isCompressing, isUploading, isAnalyzing]);

  // 画像クリア時などに、自動実行の解析済み管理ごとリセットする
  const resetOcrAll = useCallback(() => {
    analyzedFilesRef.current.clear();
    setHasAnalyzed(false);
    resetOcr();
  }, [resetOcr]);

  // 銘柄名以外に読み取れた項目（カテゴリ・産地・度数）を成功メッセージに併記する
  const details = ocrResult?.sakeName
    ? [
        ocrResult.category ? CATEGORY_DISPLAY_NAMES[ocrResult.category] : null,
        ocrResult.region,
        ocrResult.alcoholPercentage != null ? `${ocrResult.alcoholPercentage}%` : null,
      ].filter((v): v is string => v != null)
    : [];

  const ocrMessage: OcrMessage | null = ocrError
    ? { text: ocrError, variant: 'error' }
    : ocrResult?.sakeName
      ? {
          text:
            details.length > 0
              ? `銘柄名を読み取りました: ${ocrResult.sakeName}（${details.join(' / ')}）`
              : `銘柄名を読み取りました: ${ocrResult.sakeName}`,
          variant: 'success',
        }
      : null;

  return { handleOcrTrigger, isAnalyzing, ocrMessage, resetOcr: resetOcrAll, hasAnalyzed };
}
