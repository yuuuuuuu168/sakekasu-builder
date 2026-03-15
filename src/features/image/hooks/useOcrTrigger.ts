import { useOcrAnalysis } from './useOcrAnalysis';
import type { UseImageUploadReturn } from './useImageUpload';

export interface OcrMessage {
  text: string;
  variant: 'success' | 'error';
}

export function useOcrTrigger(
  imageUpload: UseImageUploadReturn,
  recordType: 'purchase' | 'drinking',
  onSakeNameDetected: (sakeName: string) => void,
) {
  const { analyzeImage, isAnalyzing, ocrResult, ocrError, resetOcr } = useOcrAnalysis();

  const handleOcrTrigger = async () => {
    const key = imageUpload.imageKey ?? await imageUpload.preUploadImage(recordType);
    if (!key) return;
    const result = await analyzeImage(key);
    if (result?.sakeName) {
      onSakeNameDetected(result.sakeName);
    }
  };

  const ocrMessage: OcrMessage | null = ocrError
    ? { text: ocrError, variant: 'error' }
    : ocrResult?.sakeName
      ? { text: `銘柄名を読み取りました: ${ocrResult.sakeName}`, variant: 'success' }
      : null;

  return { handleOcrTrigger, isAnalyzing, ocrMessage, resetOcr };
}
