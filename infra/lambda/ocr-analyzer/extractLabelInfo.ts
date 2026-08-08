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

/**
 * ラベル由来の文字列に含まれうる、インジェクションに使われがちな記号と制御文字。
 * 正当な銘柄名・産地表記にはまず現れない文字だけを対象にし、
 * アポストロフィ・&・丸括弧・年号などの商品名情報は削らない（Issue #65 の方針）
 */
// eslint-disable-next-line no-control-regex
const DANGEROUS_CHARS = /[<>{}[\]"`;\\\u0000-\u001f\u007f]/g;

/** タグ・偽 JSON などに使われる危険文字を除去する（下流の非 React 消費者への深層防御） */
function stripDangerousChars(value: string): string {
  return value.replace(DANGEROUS_CHARS, '');
}

/**
 * 有効な非空文字列なら危険文字を除去して trim し返す。それ以外は null。
 * tool スキーマの maxLength はモデルへの指示にすぎないため、
 * 異常に長い出力はここで切り詰めて下流（GraphQL・フォーム・DynamoDB）に流さない
 */
function asTrimmedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const sanitized = stripDangerousChars(value).trim();
  if (sanitized.length === 0) {
    return null;
  }
  return sanitized.slice(0, maxLength);
}

/** 銘柄名の最大長（tool スキーマの maxLength と揃える） */
const SAKE_NAME_MAX_LENGTH = 200;

/** 産地の最大長（tool スキーマの maxLength と揃える） */
const REGION_MAX_LENGTH = 100;

/** rawTexts（デバッグ用）に入れる文字列値の上限 */
const RAW_TEXT_FIELD_MAX_LENGTH = 300;

/**
 * rawTexts 用に文字列値を危険文字除去 + 切り詰めする。
 * 検証前のモデル出力をそのまま返すとインジェクション文字列の到達確認経路になるため、
 * 採用値（asTrimmedString）と同じサニタイズをデバッグ値にも適用する
 */
function forDebug(value: unknown): unknown {
  return typeof value === 'string'
    ? stripDangerousChars(value).slice(0, RAW_TEXT_FIELD_MAX_LENGTH)
    : value;
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
 * 1. input がオブジェクトでない場合は失敗扱い（全項目 null / confidence 0.0 / rawTexts 空）
 * 2. 各フィールドを検証して取得（列挙値・数値範囲・空文字は null に落とし、長さは切り詰める）
 * 3. 項目ごとの確信度を検証（項目が null なら 0.0、範囲外はクランプ）
 * 4. sakeName が読み取れない場合は他の項目も採用せず、rawTexts も返さない
 *
 * rawTexts にはデバッグ用に「既知フィールドのモデル報告値（検証前）」をホワイトリスト方式で
 * JSON にして入れる。labelTexts（ラベル転記テキスト）や想定外の追加フィールドは含めない。
 * ラベル由来の任意文字列がクライアントに渡る経路を作らないため
 * （プロンプトインジェクション・プライバシー対策）。
 */
export function extractLabelInfo(toolInput: unknown): ExtractResult {
  if (toolInput === null || typeof toolInput !== 'object' || Array.isArray(toolInput)) {
    return { ...EMPTY_RESULT, rawTexts: [] };
  }

  const input = toolInput as Record<string, unknown>;

  const sakeName = asTrimmedString(input.sakeName, SAKE_NAME_MAX_LENGTH);
  if (sakeName === null) {
    return { ...EMPTY_RESULT, rawTexts: [] };
  }

  // 既知フィールドのみをホワイトリスト方式で残す（想定外フィールドは含めない）
  const rawTexts = [
    JSON.stringify({
      sakeName: forDebug(input.sakeName),
      sakeNameConfidence: forDebug(input.sakeNameConfidence),
      category: forDebug(input.category),
      categoryConfidence: forDebug(input.categoryConfidence),
      region: forDebug(input.region),
      regionConfidence: forDebug(input.regionConfidence),
      alcoholPercentage: forDebug(input.alcoholPercentage),
      alcoholPercentageConfidence: forDebug(input.alcoholPercentageConfidence),
    }),
  ];

  const category = asCategory(input.category);
  const region = asTrimmedString(input.region, REGION_MAX_LENGTH);
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
