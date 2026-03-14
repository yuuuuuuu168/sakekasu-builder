/**
 * 銘柄名抽出ロジック
 *
 * Rekognition DetectText の結果から、お酒の銘柄名を抽出する。
 * LINE タイプのテキストのみを対象とし、非銘柄情報（容量、度数、製造者名等）を
 * フィルタリングした後、最も高い Confidence を持つテキストを銘柄名候補として返す。
 */

export interface TextDetection {
  DetectedText?: string;
  Type?: 'LINE' | 'WORD';
  Confidence?: number;
}

export interface ExtractResult {
  sakeName: string | null;
  confidence: number;
  rawTexts: string[];
}

/** 非銘柄パターン: 容量表記 */
const VOLUME_PATTERN = /\d+\s*(ml|mL|ML|ℓ|リットル)/;

/** 非銘柄パターン: アルコール度数 */
const ALCOHOL_PATTERN = /\d+\s*[%％度]/;
const ALCOHOL_KEYWORD = /アルコール/;

/** 非銘柄パターン: 製造者情報 */
const MANUFACTURER_PATTERN = /製造|醸造|酒造|株式会社|有限会社|合名会社/;

/** 非銘柄パターン: 原材料 */
const INGREDIENT_PATTERN = /原材料|米|米こうじ|醸造アルコール/;

/** 非銘柄パターン: 保存方法 */
const STORAGE_PATTERN = /保存|要冷蔵|冷暗所/;

/** 非銘柄パターン: 産地表記（3文字以上のテキストにのみ適用） */
const REGION_PATTERN = /[産県市町村都府道]/;

/**
 * テキストが非銘柄情報かどうかを判定する
 */
function isNonBrandText(text: string): boolean {
  if (VOLUME_PATTERN.test(text)) return true;
  if (ALCOHOL_PATTERN.test(text)) return true;
  if (ALCOHOL_KEYWORD.test(text)) return true;
  if (MANUFACTURER_PATTERN.test(text)) return true;
  if (INGREDIENT_PATTERN.test(text)) return true;
  if (STORAGE_PATTERN.test(text)) return true;

  // 産地表記: 3文字以上の場合のみ除外
  if (text.length >= 3 && REGION_PATTERN.test(text)) return true;

  return false;
}

/**
 * Rekognition TextDetection 配列から銘柄名を抽出する
 *
 * 1. LINE タイプのテキストのみを対象
 * 2. 非銘柄パターンに一致するテキストを除外
 * 3. 残った候補から最高 Confidence のものを選択
 * 4. Confidence を 0-100 → 0.0-1.0 に正規化
 */
export function extractSakeName(textDetections: TextDetection[]): ExtractResult {
  // LINE タイプのみ抽出
  const lines = textDetections.filter((d) => d.Type === 'LINE');

  // rawTexts: 全 LINE テキストを収集
  const rawTexts = lines
    .map((d) => d.DetectedText)
    .filter((text): text is string => text != null);

  // 非銘柄情報を除外した候補
  const candidates = lines.filter((d) => {
    if (!d.DetectedText) return false;
    return !isNonBrandText(d.DetectedText);
  });

  // 候補なしの場合
  if (candidates.length === 0) {
    return { sakeName: null, confidence: 0.0, rawTexts };
  }

  // 最高 Confidence の候補を選択
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if ((candidates[i].Confidence ?? 0) > (best.Confidence ?? 0)) {
      best = candidates[i];
    }
  }

  return {
    sakeName: best.DetectedText ?? null,
    confidence: (best.Confidence ?? 0) / 100,
    rawTexts,
  };
}
