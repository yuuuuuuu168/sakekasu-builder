import type { OcrDetectedInfo } from '../hooks/useOcrTrigger';

/**
 * OCR で読み取った産地・アルコール度数をメモ欄向けの1行テキストに整形する。
 * どちらも未検出の場合は null を返す。
 */
export function formatLabelInfoForMemo(
  info: Pick<OcrDetectedInfo, 'region' | 'alcoholPercentage'>,
): string | null {
  const parts: string[] = [];
  if (info.region) {
    parts.push(`産地: ${info.region}`);
  }
  if (info.alcoholPercentage != null) {
    parts.push(`アルコール度数: ${info.alcoholPercentage}%`);
  }
  return parts.length > 0 ? parts.join(' / ') : null;
}

/**
 * メモ欄に産地・度数の読み取り結果を追記する。
 * 既に同じ内容が含まれている場合（OCR 再実行など）は追記しない。
 */
export function appendLabelInfoToMemo(
  memo: string,
  info: Pick<OcrDetectedInfo, 'region' | 'alcoholPercentage'>,
): string {
  const label = formatLabelInfoForMemo(info);
  if (!label || memo.includes(label)) {
    return memo;
  }
  return memo ? `${memo}\n${label}` : label;
}
