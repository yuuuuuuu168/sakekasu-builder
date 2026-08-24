import type { SakeCategory } from '@/features/purchase/types';

/**
 * 記録に付ける詳細スペック（Issue #87）。
 *
 * すべて任意。銘柄名だけ書く使い方も、全項目を埋める使い方もできるように、
 * どの項目も欠けたまま保存できる。項目名は GraphQL スキーマおよび
 * OCR の抽出結果（Issue #88）と揃えてある
 */
export interface SakeSpecs {
  /** 蔵元（酒造名） */
  brewery: string | null;
  /** 産地の都道府県名または国名 */
  region: string | null;
  /** アルコール度数（%） */
  alcoholPercentage: number | null;
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

export type SpecFieldName = keyof SakeSpecs;

/**
 * フォームの入力値。
 *
 * 数値項目も文字列で持つ。入力途中の「-」や「1.」を数値に丸めてしまうと
 * 打ち込んでいる最中に値が飛ぶため、送信時にだけ数値へ変換する
 */
export type SakeSpecFormData = Record<SpecFieldName, string>;

export interface SpecFieldDef {
  key: SpecFieldName;
  label: string;
  /** 入力欄の種類。number は数値、textarea は紹介文のような長文 */
  kind: 'text' | 'number' | 'textarea';
  placeholder?: string;
  /** 入力欄の右に添える単位 */
  unit?: string;
  /** 日本酒のときだけ表示する項目 */
  nihonshuOnly?: boolean;
  /** 数値項目の許容範囲（両端を含む） */
  min?: number;
  max?: number;
  /** 整数だけを受け付けるか */
  integer?: boolean;
  /** 数値入力の刻み（type="number" の step） */
  step?: string;
  /** 文字列項目の最大長 */
  maxLength?: number;
}

/**
 * 詳細スペックの項目定義。フォームの並び順もこの順になる。
 *
 * 数値の範囲は OCR Lambda 側（extractLabelInfo.ts）の検証と揃えてある。
 * 片方だけ広げると、手入力では通るのに読み取りでは落ちる（またはその逆）ことになる
 */
export const SPEC_FIELDS: SpecFieldDef[] = [
  { key: 'brewery', label: '蔵元', kind: 'text', placeholder: '例: 旭酒造株式会社', maxLength: 100 },
  { key: 'region', label: '産地', kind: 'text', placeholder: '例: 山口県', maxLength: 100 },
  {
    key: 'alcoholPercentage',
    label: 'アルコール度数',
    kind: 'number',
    placeholder: '例: 16',
    unit: '%',
    min: 0.1,
    max: 100,
    step: '0.1',
  },
  {
    key: 'volumeMl',
    label: '容量',
    kind: 'number',
    placeholder: '例: 720',
    unit: 'ml',
    min: 1,
    max: 20000,
    integer: true,
    step: '1',
  },
  {
    key: 'specificName',
    label: '特定名称',
    kind: 'text',
    placeholder: '例: 純米大吟醸',
    nihonshuOnly: true,
    maxLength: 100,
  },
  {
    key: 'ricePolishingRatio',
    label: '精米歩合',
    kind: 'number',
    placeholder: '例: 50',
    unit: '%',
    min: 1,
    max: 100,
    integer: true,
    step: '1',
    nihonshuOnly: true,
  },
  {
    key: 'sakeMeterValue',
    label: '日本酒度',
    kind: 'number',
    placeholder: '例: +3',
    min: -100,
    max: 100,
    step: '0.1',
    nihonshuOnly: true,
  },
  {
    key: 'acidity',
    label: '酸度',
    kind: 'number',
    placeholder: '例: 1.4',
    min: 0.1,
    max: 20,
    step: '0.1',
    nihonshuOnly: true,
  },
  {
    key: 'aminoAcidity',
    label: 'アミノ酸度',
    kind: 'number',
    placeholder: '例: 1.2',
    min: 0.1,
    max: 20,
    step: '0.1',
    nihonshuOnly: true,
  },
  {
    key: 'riceVariety',
    label: '酒米',
    kind: 'text',
    placeholder: '例: 山田錦',
    nihonshuOnly: true,
    maxLength: 100,
  },
  {
    key: 'yeast',
    label: '酵母',
    kind: 'text',
    placeholder: '例: 協会9号',
    nihonshuOnly: true,
    maxLength: 100,
  },
  {
    key: 'labelDescription',
    label: '紹介文',
    kind: 'textarea',
    placeholder: 'ラベルに書かれた紹介文など',
    maxLength: 300,
  },
];

/** 項目名から定義を引くための索引 */
export const SPEC_FIELD_BY_KEY: Record<SpecFieldName, SpecFieldDef> = Object.fromEntries(
  SPEC_FIELDS.map((field) => [field.key, field]),
) as Record<SpecFieldName, SpecFieldDef>;

export const SPEC_FIELD_NAMES: SpecFieldName[] = SPEC_FIELDS.map((field) => field.key);

/**
 * そのカテゴリで表示する項目を返す。
 *
 * 日本酒向けの項目（精米歩合・日本酒度など）はウイスキーやワインの記録では
 * 埋めようがないので隠す。ウイスキーの蒸留所・熟成年数をどう持つかは
 * 銘柄名の粒度（Issue #65）と一緒に決める話なので、ここでは共通項目だけ出す
 */
export function specFieldsForCategory(category: SakeCategory): SpecFieldDef[] {
  return SPEC_FIELDS.filter((field) => !field.nihonshuOnly || category === 'NIHONSHU');
}

/**
 * この値未満の確信度は「要確認」として扱う。
 *
 * 登録時の OCR では入力欄に印を付けるだけだが、一括読み取りでは人の目を経ずに
 * 保存まで進むので、この線より下の項目は書き込まない
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

/** 詳細スペックの入力エラー。キーは項目名 */
export type SpecValidationErrors = Partial<Record<SpecFieldName, string>>;
