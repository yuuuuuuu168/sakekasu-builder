import { useState, useCallback } from 'react';
import { generateClient } from 'aws-amplify/api';
import { analyzeSakeLabel } from '@/graphql/mutations';
import type { SakeCategory } from '@/features/purchase/types';

const client = generateClient();

/** 項目ごとの確信度（0.0〜1.0）。低確信の項目は「要確認」表示に使う */
export interface OcrFieldConfidence {
  sakeName: number;
  category: number;
  region: number;
  alcoholPercentage: number;
}

export interface OcrResult {
  sakeName: string | null;
  category: SakeCategory | null;
  region: string | null;
  alcoholPercentage: number | null;
  confidence: number;
  fieldConfidence: OcrFieldConfidence;
  rawTexts: string[];
}

export interface UseOcrAnalysisReturn {
  /** OCR 解析実行（複数キーは表・裏ラベルとしてまとめて解析される） */
  analyzeImage: (imageKeys: string[]) => Promise<OcrResult | null>;
  /** 解析中フラグ */
  isAnalyzing: boolean;
  /** OCR 結果 */
  ocrResult: OcrResult | null;
  /** エラーメッセージ */
  ocrError: string | null;
  /** 状態リセット */
  resetOcr: () => void;
}

/**
 * OCR 解析のロジックを管理するカスタムフック
 *
 * - analyzeImage: AppSync 経由で analyzeSakeLabel ミューテーションを呼び出し
 * - isAnalyzing: 解析中フラグ
 * - ocrResult: OCR 結果
 * - ocrError: エラーメッセージ
 * - resetOcr: 状態リセット
 *
 * Validates: Requirements 4.1, 4.2, 5.1, 5.2, 5.3, 5.4
 */
export function useOcrAnalysis(): UseOcrAnalysisReturn {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);

  const analyzeImage = useCallback(async (imageKeys: string[]): Promise<OcrResult | null> => {
    if (imageKeys.length === 0) return null;

    setIsAnalyzing(true);
    setOcrError(null);
    setOcrResult(null);

    try {
      const result = await client.graphql({
        query: analyzeSakeLabel,
        variables: {
          imageKey: imageKeys[0],
          additionalImageKeys: imageKeys.slice(1),
        },
      });

      if ('errors' in result && result.errors && result.errors.length > 0) {
        const errorMessage = result.errors[0]?.message ?? '';
        if (errorMessage.toLowerCase().includes('timeout')) {
          setOcrError('読み取りがタイムアウトしました。もう一度お試しください');
        } else {
          setOcrError('読み取りに失敗しました。もう一度お試しください');
        }
        return null;
      }

      const data = (result as { data: { analyzeSakeLabel: OcrResult } }).data.analyzeSakeLabel;

      if (data.sakeName === null) {
        setOcrError('銘柄名を読み取れませんでした。手動で入力してください');
        setOcrResult(data);
        return data;
      }

      setOcrResult(data);
      return data;
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.name === 'AbortError' || err.message.toLowerCase().includes('timeout')) {
          setOcrError('読み取りがタイムアウトしました。もう一度お試しください');
        } else {
          setOcrError('読み取りに失敗しました。もう一度お試しください');
        }
      } else {
        setOcrError('読み取りに失敗しました。もう一度お試しください');
      }
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const resetOcr = useCallback(() => {
    setIsAnalyzing(false);
    setOcrResult(null);
    setOcrError(null);
  }, []);

  return {
    analyzeImage,
    isAnalyzing,
    ocrResult,
    ocrError,
    resetOcr,
  };
}
