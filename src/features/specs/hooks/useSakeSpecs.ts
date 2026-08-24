import { useCallback, useMemo, useState } from 'react';

import {
  applyOcrSpecs,
  createEmptySpecFormData,
  validateSpecFormData,
  type OcrSpecValues,
} from '../lib/sakeSpecs';
import type { SakeSpecFormData, SpecFieldName, SpecValidationErrors } from '../types';

export interface UseSakeSpecsReturn {
  specs: SakeSpecFormData;
  /** 表示するエラー。触れていない項目のエラーは、送信を試みるまで出さない */
  specErrors: SpecValidationErrors;
  /** OCR が低い確信度で埋めた項目。入力欄に「要確認」を添えるのに使う */
  lowConfidenceSpecFields: SpecFieldName[];
  handleSpecChange: (field: SpecFieldName, value: string) => void;
  handleSpecBlur: (field: SpecFieldName) => void;
  /**
   * 送信前の検証。エラーがあれば false を返し、以降は全項目のエラーを表示する
   */
  validateSpecs: () => boolean;
  /** OCR の読み取り結果を反映する（overwrite が false なら入力済みの項目は残す） */
  applyOcrResult: (
    values: OcrSpecValues,
    lowConfidenceFields: SpecFieldName[],
    options: { overwrite: boolean },
  ) => void;
  resetSpecs: () => void;
}

/**
 * 詳細スペック（Issue #87）の入力状態をまとめて持つフック。
 *
 * 購入フォームと飲酒フォームで同じものを使う。本体のフォームデータには混ぜない。
 * 必須項目の検証とは性質が違ううえ、どちらのフォームにも同じ形で足せるため
 */
export function useSakeSpecs(initialSpecs?: SakeSpecFormData): UseSakeSpecsReturn {
  const [specs, setSpecs] = useState<SakeSpecFormData>(
    () => initialSpecs ?? createEmptySpecFormData(),
  );
  // エラーを出す項目。入力途中の値で赤くしないよう、blur した項目だけを対象にする
  const [touched, setTouched] = useState<Set<SpecFieldName>>(() => new Set());
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [lowConfidenceSpecFields, setLowConfidenceSpecFields] = useState<SpecFieldName[]>([]);

  const allErrors = useMemo(() => validateSpecFormData(specs), [specs]);

  const specErrors = useMemo<SpecValidationErrors>(() => {
    if (showAllErrors) return allErrors;
    return Object.fromEntries(
      Object.entries(allErrors).filter(([key]) => touched.has(key as SpecFieldName)),
    );
  }, [allErrors, showAllErrors, touched]);

  const handleSpecChange = useCallback((field: SpecFieldName, value: string) => {
    setSpecs((prev) => ({ ...prev, [field]: value }));
    // 手で直した項目は確認済みとみなし、「要確認」の印を外す
    setLowConfidenceSpecFields((prev) => prev.filter((key) => key !== field));
  }, []);

  const handleSpecBlur = useCallback((field: SpecFieldName) => {
    setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
  }, []);

  const validateSpecs = useCallback(() => {
    setShowAllErrors(true);
    return Object.keys(allErrors).length === 0;
  }, [allErrors]);

  const applyOcrResult = useCallback(
    (
      values: OcrSpecValues,
      lowConfidenceFields: SpecFieldName[],
      { overwrite }: { overwrite: boolean },
    ) => {
      const next = applyOcrSpecs(specs, values, { overwrite });
      setSpecs(next);
      // 実際に書き込まれた項目にだけ「要確認」を付ける。
      // 入力済みで上書きしなかった項目に付けても、直す先が無い
      setLowConfidenceSpecFields(
        lowConfidenceFields.filter((field) => next[field] !== specs[field]),
      );
    },
    [specs],
  );

  const resetSpecs = useCallback(() => {
    setSpecs(createEmptySpecFormData());
    setTouched(new Set());
    setShowAllErrors(false);
    setLowConfidenceSpecFields([]);
  }, []);

  return {
    specs,
    specErrors,
    lowConfidenceSpecFields,
    handleSpecChange,
    handleSpecBlur,
    validateSpecs,
    applyOcrResult,
    resetSpecs,
  };
}
