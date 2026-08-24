/**
 * ラベル情報抽出ロジック
 *
 * Amazon Bedrock（Claude Haiku）の tool use 入力（record_label_info の input）から、
 * お酒のラベル情報（銘柄名・カテゴリ・産地・アルコール度数と、裏ラベルの詳細スペック）
 * と項目ごとの確信度を検証・抽出する。
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

/**
 * 裏ラベルから読み取る詳細スペック（Issue #88）。
 * 項目名は PurchaseRecord / DrinkingRecord の保存先（Issue #87）と揃えてある
 */
export interface SpecFields {
  /** 蔵元（酒造名）。住所は含めない */
  brewery: string | null;
  /** 容量（ml） */
  volumeMl: number | null;
  /** 特定名称（純米大吟醸など） */
  specificName: string | null;
  /** 精米歩合（%） */
  ricePolishingRatio: number | null;
  /** 日本酒度。甘口側は負の値になる */
  sakeMeterValue: number | null;
  /** 酸度 */
  acidity: number | null;
  /** アミノ酸度 */
  aminoAcidity: number | null;
  /** 酒米（品種名） */
  riceVariety: string | null;
  /** 酵母 */
  yeast: string | null;
  /** ラベルに書かれた紹介文 */
  labelDescription: string | null;
}

/** 項目ごとの確信度（0.0〜1.0）。項目が null のときは必ず 0.0 */
export type FieldConfidence = {
  sakeName: number;
  category: number;
  region: number;
  alcoholPercentage: number;
} & Record<keyof SpecFields, number>;

export interface ExtractResult extends SpecFields {
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

/** 蔵元・特定名称・酒米・酵母など、短い語句として読み取る項目の最大長 */
const SPEC_TERM_MAX_LENGTH = 100;

/**
 * 紹介文の最大長。
 *
 * ここだけはラベルの文章がまとまってクライアントへ渡る。危険文字の除去は
 * 銘柄名・産地と同じものが効くが、量が多いぶん影響も大きいので短めに切る。
 * モデルには「指示めいた記述は写さない」と伝えてある（index.ts のプロンプト）
 */
const LABEL_DESCRIPTION_MAX_LENGTH = 300;

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

/**
 * 数値として妥当（min 以上 max 以下）なら返す。それ以外は null。
 * integer を指定した項目は丸めてから範囲を見る（容量・精米歩合）
 */
function asBoundedNumber(
  value: unknown,
  { min, max, integer = false }: { min: number; max: number; integer?: boolean },
): number | null {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const num = integer ? Math.round(parsed) : parsed;
  return num >= min && num <= max ? num : null;
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
 * ラベルの転記テキスト（labelTexts）を照合用の1本の文字列にまとめる。
 *
 * 全角・半角や大文字小文字の違いを均し、空白を落とす。ラベルは「精米歩合 ６０％」の
 * ように全角の数字で組まれていることがあり、そのままでは照合できない
 */
function toLabelHaystack(value: unknown): string {
  if (!Array.isArray(value)) {
    return '';
  }
  return value
    .filter((line): line is string => typeof line === 'string')
    .join('\n')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * 読み取った値が、転記したラベルの文字の中に実際に現れているかを見る。
 *
 * これが要る理由。ラベルに数値が見当たらないとき、モデルは日本酒の一般的な値
 * （精米歩合60・日本酒度+3・酸度1.4・アミノ酸度1.2）を埋めて、しかも確信度 0.95 と
 * 申告してくる。実際に別々の酒で同じ組み合わせが書き込まれた。プロンプトで
 * 「推測せず null」と伝えても守られず、自己申告の確信度も歯止めにならない。
 *
 * labelTexts はラベルの転記で、各項目の判定より先に生成される。そこに無い値は
 * 読み取ったものではないので採らない。お願いではなく照合で止める
 */
function isGroundedInLabel(reported: unknown, haystack: string): boolean {
  if (haystack === '') {
    // 転記が空なら照合のしようがない。判定を諦めて素通しにはしない
    return false;
  }
  if (typeof reported !== 'string' && typeof reported !== 'number') {
    return false;
  }
  const needle = String(reported).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  return needle !== '' && haystack.includes(needle);
}

/**
 * 転記テキストとの照合を求める項目。
 *
 * 捏造が起きたのは裏ラベルの数値と、その周りの語（酒米・酵母・特定名称）。
 * 産地は「製造者の住所から判断してもよい」ことにしているので外す。銘柄名も
 * カナへの読み替え（ARRAN → アラン）で字面が変わるため外す。紹介文はラベルの
 * 文章そのものを写す項目で、切り詰めや要約で一致しなくなるので外す
 */
const GROUNDED_SPEC_FIELDS: ReadonlySet<keyof SpecFields> = new Set([
  'specificName',
  'ricePolishingRatio',
  'sakeMeterValue',
  'acidity',
  'aminoAcidity',
  'riceVariety',
  'yeast',
]);

/**
 * 詳細スペック項目ごとの検証。
 *
 * 数値項目の下限に 0 を含めないのは、読み取れなかったときにモデルが 0 を返すことが
 * あるため（null で返すよう指示はしているが、守られる保証はない）。0 が正当な値に
 * なりうる日本酒度（±0）だけは負側まで許す
 */
const SPEC_PARSERS: { [K in keyof SpecFields]: (value: unknown) => SpecFields[K] } = {
  brewery: (value) => asTrimmedString(value, SPEC_TERM_MAX_LENGTH),
  // 一升瓶（1800ml）やマグナム（3000ml）は通し、桁を読み違えた値だけ落とす
  volumeMl: (value) => asBoundedNumber(value, { min: 1, max: 20000, integer: true }),
  specificName: (value) => asTrimmedString(value, SPEC_TERM_MAX_LENGTH),
  ricePolishingRatio: (value) => asBoundedNumber(value, { min: 1, max: 100, integer: true }),
  sakeMeterValue: (value) => asBoundedNumber(value, { min: -100, max: 100 }),
  acidity: (value) => asBoundedNumber(value, { min: 0.1, max: 20 }),
  aminoAcidity: (value) => asBoundedNumber(value, { min: 0.1, max: 20 }),
  riceVariety: (value) => asTrimmedString(value, SPEC_TERM_MAX_LENGTH),
  yeast: (value) => asTrimmedString(value, SPEC_TERM_MAX_LENGTH),
  labelDescription: (value) => asTrimmedString(value, LABEL_DESCRIPTION_MAX_LENGTH),
};

/** 詳細スペックの項目名一覧（抽出・確信度・rawTexts で同じ並びを使う） */
export const SPEC_FIELD_NAMES = Object.keys(SPEC_PARSERS) as (keyof SpecFields)[];

/** 確信度を報告させるプロパティ名（sakeName → sakeNameConfidence） */
function confidenceKey(field: string): string {
  return `${field}Confidence`;
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

/** 全項目 null の詳細スペック */
const EMPTY_SPECS = Object.fromEntries(
  SPEC_FIELD_NAMES.map((field) => [field, null]),
) as SpecFields;

const ZERO_CONFIDENCE: FieldConfidence = {
  sakeName: 0,
  category: 0,
  region: 0,
  alcoholPercentage: 0,
  ...(Object.fromEntries(SPEC_FIELD_NAMES.map((field) => [field, 0])) as Record<
    keyof SpecFields,
    number
  >),
};

const EMPTY_RESULT: Omit<ExtractResult, 'rawTexts'> = {
  sakeName: null,
  category: null,
  region: null,
  alcoholPercentage: null,
  ...EMPTY_SPECS,
  confidence: 0.0,
  fieldConfidence: ZERO_CONFIDENCE,
};

/**
 * tool use の input からラベル情報を抽出する
 *
 * 1. input がオブジェクトでない場合は失敗扱い（全項目 null / confidence 0.0 / rawTexts 空）
 * 2. 各フィールドを検証して取得（列挙値・数値範囲・空文字は null に落とし、長さは切り詰める）
 * 3. 裏ラベルの数値まわりは、転記テキストに実際に現れているかを照合して落とす
 *    （GROUNDED_SPEC_FIELDS。読めないと一般的な値を埋めてくるため）
 * 4. 項目ごとの確信度を検証（項目が null なら 0.0、範囲外はクランプ）
 * 5. sakeName が読み取れない場合は他の項目も採用せず、rawTexts も返さない
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
  const debugFields = [
    'sakeName',
    'category',
    'region',
    'alcoholPercentage',
    ...SPEC_FIELD_NAMES,
  ];
  const rawTexts = [
    JSON.stringify(
      Object.fromEntries(
        debugFields.flatMap((field) => [
          [field, forDebug(input[field])],
          [confidenceKey(field), forDebug(input[confidenceKey(field)])],
        ]),
      ),
    ),
  ];

  const category = asCategory(input.category);
  const region = asTrimmedString(input.region, REGION_MAX_LENGTH);
  const alcoholPercentage = asAlcoholPercentage(input.alcoholPercentage);

  // ラベルに実際に書かれていた値だけを採る（捏造対策）
  const haystack = toLabelHaystack(input.labelTexts);
  const ungrounded: string[] = [];
  const specs = Object.fromEntries(
    SPEC_FIELD_NAMES.map((field) => {
      const value = SPEC_PARSERS[field](input[field]);
      // 照合はモデルが報告した生の値に対して行う。丸めたあとの値で見ると、
      // ラベルに「49.8」と書いてあるのに「50」を探すことになって外れる
      if (value !== null && GROUNDED_SPEC_FIELDS.has(field) && !isGroundedInLabel(input[field], haystack)) {
        ungrounded.push(field);
        return [field, null];
      }
      return [field, value];
    }),
  ) as SpecFields;

  if (ungrounded.length > 0) {
    // 項目名だけ出す。落とした値はラベル由来の文字列なのでログに残さない
    console.warn('[OCR] dropped ungrounded spec fields:', JSON.stringify(ungrounded));
  }

  const fieldConfidence: FieldConfidence = {
    sakeName: asConfidence(input.sakeNameConfidence, sakeName),
    category: asConfidence(input.categoryConfidence, category),
    region: asConfidence(input.regionConfidence, region),
    alcoholPercentage: asConfidence(input.alcoholPercentageConfidence, alcoholPercentage),
    ...(Object.fromEntries(
      SPEC_FIELD_NAMES.map((field) => [
        field,
        asConfidence(input[confidenceKey(field)], specs[field]),
      ]),
    ) as Record<keyof SpecFields, number>),
  };

  return {
    sakeName,
    category,
    region,
    alcoholPercentage,
    ...specs,
    confidence: fieldConfidence.sakeName,
    fieldConfidence,
    rawTexts,
  };
}
