import { useCallback, useRef } from 'react';
import { useOcrTrigger } from './useOcrTrigger';
import type { UseImageUploadReturn } from './useImageUpload';
import type { UseSakeSpecsReturn } from '@/features/specs/hooks/useSakeSpecs';
import type { RecordType } from '@/types/sake';

interface UseRecordOcrOptions {
  imageUpload: UseImageUploadReturn;
  recordType: RecordType;
  /** いま入力されている銘柄名（自動実行で上書きしてよいかの判定に使う） */
  sakeName: string;
  setSakeName: (value: string) => void;
  /** 選択肢から来た値をそのまま受ける（フォームの handleChange と同じ） */
  setCategory: (value: string) => void;
  specs: Pick<UseSakeSpecsReturn, 'applyOcrResult'>;
}

/**
 * 購入・飲酒フォームのラベル読み取り（OCR）の結果をフォームへ入れる。
 *
 * 自動実行では入力済みの銘柄名・手で選んだカテゴリ・入力済みのスペックを上書きしない。
 * 手動の再読み取りは上書きする。カテゴリを手で選んだかどうかはここで覚えておく
 */
export function useRecordOcr({
  imageUpload,
  recordType,
  sakeName,
  setSakeName,
  setCategory,
  specs,
}: UseRecordOcrOptions) {
  // ユーザーが手動でカテゴリを選択したか（自動OCRで選択を上書きしないための追跡）
  const categoryTouchedRef = useRef(false);

  const ocr = useOcrTrigger(imageUpload, recordType, (info, { isAuto }) => {
    if (!isAuto || sakeName.trim() === '') {
      setSakeName(info.sakeName);
    }
    if (info.category && (!isAuto || !categoryTouchedRef.current)) {
      setCategory(info.category);
    }
    // 産地・度数を含む詳細スペックはそれぞれの入力欄へ入れる（Issue #87・#88）。
    // 自動実行では入力済みの項目を残す
    specs.applyOcrResult(info.specs, info.lowConfidenceSpecFields, { overwrite: !isAuto });
  });

  /** カテゴリ欄で手で選んだとき。以後の自動読み取りでは上書きしない */
  const selectCategory = useCallback(
    (value: string) => {
      categoryTouchedRef.current = true;
      setCategory(value);
    },
    [setCategory],
  );

  const { resetOcr } = ocr;
  /**
   * 登録が済んでフォームを戻すとき。OCR の解析済みの管理も初期化する
   * （同じ画像の再登録で自動OCRが動くように）
   */
  const resetAfterSubmit = useCallback(() => {
    categoryTouchedRef.current = false;
    resetOcr();
  }, [resetOcr]);

  return { ...ocr, selectCategory, resetAfterSubmit };
}

export type UseRecordOcrReturn = ReturnType<typeof useRecordOcr>;
