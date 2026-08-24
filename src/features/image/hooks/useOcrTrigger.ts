import { useCallback, useEffect, useRef, useState } from 'react';
import { useOcrAnalysis, type OcrResult } from './useOcrAnalysis';
import type { UseImageUploadReturn } from './useImageUpload';
import type { SakeCategory } from '@/features/purchase/types';
import {
  LOW_CONFIDENCE_THRESHOLD,
  SPEC_FIELD_NAMES,
  type SpecFieldName,
} from '@/features/specs/types';
import type { OcrSpecValues } from '@/features/specs/lib/sakeSpecs';
import { CATEGORY_DISPLAY_NAMES } from '@/components/form/CategorySelect';

export interface OcrMessage {
  text: string;
  variant: 'success' | 'error';
}

/** OCR で銘柄名が読み取れたときにフォームへ渡す検出結果 */
export interface OcrDetectedInfo {
  sakeName: string;
  category: SakeCategory | null;
  /**
   * 詳細スペックの読み取り結果（産地・アルコール度数を含む。Issue #88）。
   * 読み取れなかった項目は入らないので、そのまま入力欄へ流し込める
   */
  specs: OcrSpecValues;
  /** 確信度が低く、目視確認を促したい詳細スペックの項目 */
  lowConfidenceSpecFields: SpecFieldName[];
}

export interface OcrDetectedOptions {
  /** 画像追加を検知した自動実行か（true なら入力済みフィールドを上書きしない等の制御に使う） */
  isAuto: boolean;
}

/** 複数枚を連続で追加したときに1回の解析にまとめるための待ち時間 */
const AUTO_OCR_DEBOUNCE_MS = 1000;

/** 確信度が低い項目に「（要確認）」を付ける（fieldConfidence 未対応の旧レスポンスでは付けない） */
function markIfLowConfidence(label: string, confidence: number | undefined): string {
  return confidence !== undefined && confidence < LOW_CONFIDENCE_THRESHOLD
    ? `${label}（要確認）`
    : label;
}

/**
 * 解析結果から、値の入った詳細スペックだけを取り出す。
 *
 * 読み取れなかった項目（null）を落としておくと、フォーム側は
 * 「渡ってきた項目 = 埋める項目」として扱える
 */
function pickDetectedSpecs(result: OcrResult): OcrSpecValues {
  return Object.fromEntries(
    SPEC_FIELD_NAMES.filter((field) => result[field] != null).map((field) => [
      field,
      result[field],
    ]),
  );
}

/** 値は読み取れたが確信度が低い項目。入力欄に「要確認」を付けるのに使う */
function pickLowConfidenceSpecFields(result: OcrResult): SpecFieldName[] {
  return SPEC_FIELD_NAMES.filter(
    (field) =>
      result[field] != null && (result.fieldConfidence?.[field] ?? 0) < LOW_CONFIDENCE_THRESHOLD,
  );
}

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

    // 選択中の全画像（表・裏ラベルなど）をアップロードしてまとめて解析する
    const keys = await imageUpload.preUploadImages(recordType);
    if (keys.length === 0) return;
    // アップロードに失敗したときはボタンを「再読み取り」表記にしない（読み取りは未実施のため）
    setHasAnalyzed(true);
    const result = await analyzeImage(keys);
    if (result?.sakeName) {
      onOcrDetected(
        {
          sakeName: result.sakeName,
          category: result.category ?? null,
          specs: pickDetectedSpecs(result),
          lowConfidenceSpecFields: pickLowConfidenceSpecFields(result),
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

  // 銘柄名以外に読み取れたものを成功メッセージに併記する。
  // カテゴリは確信度が低ければ「（要確認）」を付け、詳細スペックは件数だけ伝える
  // （項目ごとの「要確認」は入力欄の側に出す。12項目を全部並べると読めない）
  const fieldConfidence = ocrResult?.fieldConfidence;
  const detectedSpecCount = ocrResult?.sakeName
    ? Object.keys(pickDetectedSpecs(ocrResult)).length
    : 0;
  const details = ocrResult?.sakeName
    ? [
        ocrResult.category
          ? markIfLowConfidence(
              CATEGORY_DISPLAY_NAMES[ocrResult.category],
              fieldConfidence?.category,
            )
          : null,
        detectedSpecCount > 0 ? `詳細スペック${detectedSpecCount}件` : null,
      ].filter((v): v is string => v != null)
    : [];

  const detectedSakeName = ocrResult?.sakeName
    ? markIfLowConfidence(ocrResult.sakeName, fieldConfidence?.sakeName)
    : null;

  const ocrMessage: OcrMessage | null = ocrError
    ? { text: ocrError, variant: 'error' }
    : detectedSakeName
      ? {
          text:
            details.length > 0
              ? `銘柄名を読み取りました: ${detectedSakeName}（${details.join(' / ')}）`
              : `銘柄名を読み取りました: ${detectedSakeName}`,
          variant: 'success',
        }
      : null;

  return { handleOcrTrigger, isAnalyzing, ocrMessage, resetOcr: resetOcrAll, hasAnalyzed };
}
