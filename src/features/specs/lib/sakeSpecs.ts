import {
  SPEC_FIELDS,
  SPEC_FIELD_NAMES,
  type SakeSpecFormData,
  type SakeSpecs,
  type SpecFieldDef,
  type SpecFieldName,
  type SpecValidationErrors,
} from '../types';

/** 数値として扱う項目か */
function isNumberField(field: SpecFieldDef): boolean {
  return field.kind === 'number';
}

/** 何も入力していない状態の詳細スペック */
export function createEmptySpecFormData(): SakeSpecFormData {
  return Object.fromEntries(SPEC_FIELD_NAMES.map((key) => [key, ''])) as SakeSpecFormData;
}

/**
 * 保存済みの詳細スペックをフォームの入力値に戻す。
 * 未設定（null / undefined）の項目は空文字にする
 */
export function specsToFormData(
  specs: Partial<SakeSpecs> | null | undefined,
): SakeSpecFormData {
  return Object.fromEntries(
    SPEC_FIELD_NAMES.map((key) => {
      const value = specs?.[key];
      return [key, value == null ? '' : String(value)];
    }),
  ) as SakeSpecFormData;
}

/**
 * 入力値を保存用の値に変換する。
 *
 * 空欄は null にする。数値項目は数値へ変換し、数値として読めないものも null に落とす
 * （送信前に validateSpecFormData で弾いているので、ここに来るのは正常な値だけ）
 */
export function formDataToSpecs(form: SakeSpecFormData): SakeSpecs {
  return Object.fromEntries(
    SPEC_FIELDS.map((field) => {
      const raw = form[field.key].trim();
      if (raw === '') {
        return [field.key, null];
      }
      if (!isNumberField(field)) {
        return [field.key, raw];
      }
      const num = Number(raw);
      return [field.key, Number.isFinite(num) ? num : null];
    }),
  ) as SakeSpecs;
}

/**
 * 入力値を検証する。エラーが無ければ空オブジェクト。
 *
 * 数値の範囲は OCR Lambda 側（extractLabelInfo.ts）の検証と揃えてある。
 * 空欄は「未入力」であってエラーではない（詳細スペックはすべて任意）
 */
export function validateSpecFormData(form: SakeSpecFormData): SpecValidationErrors {
  const errors: SpecValidationErrors = {};

  for (const field of SPEC_FIELDS) {
    const raw = form[field.key].trim();
    if (raw === '') continue;

    if (!isNumberField(field)) {
      if (field.maxLength !== undefined && raw.length > field.maxLength) {
        errors[field.key] = `${field.label}は${field.maxLength}文字以内で入力してください`;
      }
      continue;
    }

    const num = Number(raw);
    if (!Number.isFinite(num)) {
      errors[field.key] = `${field.label}は数値で入力してください`;
      continue;
    }
    if (field.integer && !Number.isInteger(num)) {
      errors[field.key] = `${field.label}は整数で入力してください`;
      continue;
    }
    if (
      (field.min !== undefined && num < field.min) ||
      (field.max !== undefined && num > field.max)
    ) {
      errors[field.key] = `${field.label}は${field.min}〜${field.max}の範囲で入力してください`;
    }
  }

  return errors;
}

/** 1項目でも入力されているか（アコーディオンを開いた状態で出すかの判定に使う） */
export function hasAnySpecValue(form: SakeSpecFormData): boolean {
  return SPEC_FIELD_NAMES.some((key) => form[key].trim() !== '');
}

/**
 * API から返った記録から詳細スペックの項目だけを取り出す。
 *
 * この項目より前に作られた記録では値が undefined で返るので null に揃える。
 * 以降の処理が「未設定 = null」の一通りだけを見ればよくなる
 */
export function pickSakeSpecs(record: Partial<SakeSpecs>): SakeSpecs {
  return Object.fromEntries(
    SPEC_FIELD_NAMES.map((key) => [key, record[key] ?? null]),
  ) as unknown as SakeSpecs;
}

/**
 * 作成 mutation へ渡す入力。値のある項目だけを載せる。
 * 全項目 null を書き込むと、詳細スペックを使わない記録にも空の属性が並ぶ
 */
export function specsToCreateInput(form: SakeSpecFormData): Partial<SakeSpecs> {
  const specs = formDataToSpecs(form);
  return Object.fromEntries(
    SPEC_FIELD_NAMES.filter((key) => specs[key] != null).map((key) => [key, specs[key]]),
  );
}

/**
 * 更新 mutation へ渡す入力。null も含めて全項目を載せる。
 *
 * 更新リゾルバーは渡されたフィールドだけを SET するので、消したい項目を
 * 省いてしまうと以前の値が残る。入力欄を空にしたら消える、を成り立たせる
 */
export function specsToUpdateInput(form: SakeSpecFormData): SakeSpecs {
  return formDataToSpecs(form);
}

/** 表示用に整形した1項目 */
export interface SpecDisplayEntry {
  key: SpecFieldName;
  label: string;
  value: string;
}

/**
 * 値のある項目だけを表示用に整形する。
 *
 * カテゴリでは絞らない。日本酒向けの項目に値が入ったままカテゴリを変えた記録でも、
 * 保存されている値が画面から消えてしまわないようにする
 */
export function toSpecDisplayEntries(
  specs: Partial<SakeSpecs> | null | undefined,
): SpecDisplayEntry[] {
  if (!specs) return [];

  return SPEC_FIELDS.filter((field) => specs[field.key] != null).map((field) => ({
    key: field.key,
    label: field.label,
    value: formatSpecValue(field, specs[field.key]!),
  }));
}

/** 単位を添えた表示用の値。日本酒度だけは正の値に + を付ける（ラベルの表記に合わせる） */
function formatSpecValue(field: SpecFieldDef, value: string | number): string {
  if (typeof value !== 'number') {
    return value;
  }
  const text = field.key === 'sakeMeterValue' && value > 0 ? `+${value}` : String(value);
  return field.unit ? `${text}${field.unit}` : text;
}

/** 詳細スペックのうち、OCR が読み取れた項目（値のあるものだけ） */
export type OcrSpecValues = Partial<Record<SpecFieldName, string | number | null>>;

/**
 * OCR の読み取り結果をフォームの入力値へ反映する。
 *
 * 自動実行（画像を足したときの読み取り）では、すでに入力されている項目を
 * 上書きしない。手で直したあとに裏ラベルを足したら書き戻された、が起きないようにする。
 * 手動の再読み取りでは読み取れた項目を上書きする（PR #80 の銘柄名と同じ扱い）
 */
export function applyOcrSpecs(
  current: SakeSpecFormData,
  ocr: OcrSpecValues,
  { overwrite }: { overwrite: boolean },
): SakeSpecFormData {
  const next = { ...current };

  for (const key of SPEC_FIELD_NAMES) {
    const value = ocr[key];
    if (value == null) continue;
    if (!overwrite && next[key].trim() !== '') continue;
    next[key] = String(value);
  }

  return next;
}
