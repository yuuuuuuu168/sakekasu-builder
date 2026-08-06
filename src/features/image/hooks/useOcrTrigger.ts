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

export function useOcrTrigger(
  imageUpload: UseImageUploadReturn,
  recordType: 'purchase' | 'drinking',
  onOcrDetected: (info: OcrDetectedInfo) => void,
) {
  const { analyzeImage, isAnalyzing, ocrResult, ocrError, resetOcr } = useOcrAnalysis();

  const handleOcrTrigger = async () => {
    // 選択中の全画像（表・裏ラベルなど）をアップロードしてまとめて解析する
    const keys = await imageUpload.preUploadImages(recordType);
    if (keys.length === 0) return;
    const result = await analyzeImage(keys);
    if (result?.sakeName) {
      onOcrDetected({
        sakeName: result.sakeName,
        category: result.category ?? null,
        region: result.region ?? null,
        alcoholPercentage: result.alcoholPercentage ?? null,
      });
    }
  };

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

  return { handleOcrTrigger, isAnalyzing, ocrMessage, resetOcr };
}
