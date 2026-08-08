/**
 * ラベル情報抽出ロジック
 *
 * Amazon Bedrock（Claude Haiku）の tool use 入力（record_label_info の input）から、
 * お酒のラベル情報（銘柄名・カテゴリ・産地・アルコール度数）と項目ごとの確信度を
 * 検証・抽出する。
 *
 * tool の input_schema で構造を強制しているため、テキストから JSON を探す処理は
 * 不要になったが、モデル出力は信頼せず全フィールドをここで再検証する。
 */

export type SakeCategory = 'NIHONSHU' | 'BEER' | 'WINE' | 'WHISKY' | 'SHOCHU' | 'OTHER';

const SAKE_CATEGORIES: readonly string[] = [
  'NIHONSHU',
  'BEER',
  'WINE',
  'WHISKY',
  'SHOCHU',
  'OTHER',
];

/** 項目ごとの確信度（0.0〜1.0）。項目が null のときは必ず 0.0 */
export interface FieldConfidence {
  sakeName: number;
  category: number;
  region: number;
  alcoholPercentage: number;
}

export interface ExtractResult {
  sakeName: string | null;
  category: SakeCategory | null;
  region: string | null;
  alcoholPercentage: number | null;
  /** 後方互換の総合確信度（= fieldConfidence.sakeName） */
  confidence: number;
  fieldConfidence: FieldConfidence;
  rawTexts: string[];
}

/** 有効な非空文字列なら trim して返す。それ以外は null */
function asTrimmedString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

/** SakeCategory 列挙値として有効なら返す。それ以外は null */
function asCategory(value: unknown): SakeCategory | null {
  if (typeof value === 'string' && SAKE_CATEGORIES.includes(value.toUpperCase())) {
    return value.toUpperCase() as SakeCategory;
  }
  return null;
}

/** アルコール度数として妥当（0 より大きく 100 以下の数値）なら返す。それ以外は null */
function asAlcoholPercentage(value: unknown): number | null {
  const num =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (Number.isFinite(num) && num > 0 && num <= 100) {
    return num;
  }
  return null;
}

/**
 * モデルが報告した確信度を検証する。
 * 数値でなければ 0、範囲外は 0〜1 にクランプ。
 * 対応する項目の値が null のときは確信度も 0 に強制する。
 */
function asConfidence(value: unknown, fieldValue: unknown): number {
  if (fieldValue === null) {
    return 0;
  }
  const num = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.min(1, Math.max(0, num));
}

const ZERO_CONFIDENCE: FieldConfidence = {
  sakeName: 0,
  category: 0,
  region: 0,
  alcoholPercentage: 0,
};

const EMPTY_RESULT: Omit<ExtractResult, 'rawTexts'> = {
  sakeName: null,
  category: null,
  region: null,
  alcoholPercentage: null,
  confidence: 0.0,
  fieldConfidence: ZERO_CONFIDENCE,
};

/**
 * tool use の input からラベル情報を抽出する
 *
 * 1. input がオブジェクトでない場合は失敗扱い（全項目 null / confidence 0.0）
 * 2. 各フィールドを検証して取得（列挙値・数値範囲・空文字は null に落とす）
 * 3. 項目ごとの確信度を検証（項目が null なら 0.0、範囲外はクランプ）
 * 4. sakeName が読み取れない場合は他の項目も採用しない（従来挙動の維持）
 *
 * rawTexts にはデバッグ用に「検証前のモデル報告値」を JSON で入れるが、
 * labelTexts（ラベル転記テキスト）は含めない。転記にはラベル由来の任意文字列が
 * 入りうるため、クライアントには返さない（プロンプトインジェクション・プライバシー対策）。
 */
export function extractLabelInfo(toolInput: unknown): ExtractResult {
  if (toolInput === null || typeof toolInput !== 'object' || Array.isArray(toolInput)) {
    return { ...EMPTY_RESULT, rawTexts: [] };
  }

  const input = toolInput as Record<string, unknown>;

  // labelTexts を除いたモデル報告値（検証前）をデバッグ用に残す
  const reported = { ...input };
  delete reported.labelTexts;
  const rawTexts = [JSON.stringify(reported)];

  const sakeName = asTrimmedString(input.sakeName);
  if (sakeName === null) {
    return { ...EMPTY_RESULT, rawTexts };
  }

  const category = asCategory(input.category);
  const region = asTrimmedString(input.region);
  const alcoholPercentage = asAlcoholPercentage(input.alcoholPercentage);

  const fieldConfidence: FieldConfidence = {
    sakeName: asConfidence(input.sakeNameConfidence, sakeName),
    category: asConfidence(input.categoryConfidence, category),
    region: asConfidence(input.regionConfidence, region),
    alcoholPercentage: asConfidence(input.alcoholPercentageConfidence, alcoholPercentage),
  };

  return {
    sakeName,
    category,
    region,
    alcoholPercentage,
    confidence: fieldConfidence.sakeName,
    fieldConfidence,
    rawTexts,
  };
}
