import { generateClient } from 'aws-amplify/api';
import { analyzeSakeLabel } from '@/graphql/mutations';
import {
  LOW_CONFIDENCE_THRESHOLD,
  SPEC_FIELD_NAMES,
  type SakeSpecs,
  type SpecFieldName,
} from '../types';

const client = generateClient();

/** 解析結果のうち、この関数が見る部分 */
type AnalyzeResponse = Partial<SakeSpecs> & {
  sakeName: string | null;
  fieldConfidence?: Partial<Record<SpecFieldName, number>> | null;
};

/**
 * 読み取りの結果。呼び出し側が「もう一度投げる価値があるか」を決められる形で返す。
 *
 * - `read` … 解析は通った。読めた項目だけが `specs` に入る（空のこともある）
 * - `retryable` … 通信・スロットリング・一時的な失敗。やり直せば結果が変わりうる
 * - `permanent` … 画像そのものが原因。同じ画像を投げる限り必ず同じ失敗になる
 *
 * `permanent` を `retryable` と混ぜていたせいで、一括読み取りが同じ画像を
 * 毎回投げ直していた（2026-08-24、150 回中 78 回が `Image too large for OCR`）
 */
export type LabelSpecsOutcome =
  | { status: 'read'; specs: Partial<SakeSpecs> }
  | { status: 'retryable' }
  | { status: 'permanent' };

/**
 * 同じ画像を投げる限り必ず同じ失敗になる、OCR Lambda のエラー。
 *
 * 原因は画像のバイト列そのものなので、やり直しても、読み取りの精度を上げても
 * 結果は変わらない。文字列の出どころは `infra/lambda/ocr-analyzer/index.ts` の
 * `assertImagesFitBedrockLimit()` と `assertImagesAreRealImages()`。
 * あちらを変えるときはここも直す。
 *
 * 一致しなくなっても機能は壊れず、`retryable` に倒れて元の「毎回投げ直す」
 * 挙動に戻るだけなので、気づく手立てとして Lambda 側にも注意書きを置いてある。
 *
 * 画像の取得失敗（`Failed to retrieve image from storage`）はここに入れない。
 * S3 の一時的な不調でも同じ文言になるため、やり直せる側に倒す
 */
const PERMANENT_FAILURE_MESSAGES = ['Image too large for OCR', 'Invalid image content'];

/** GraphQL の応答・例外から、エラーの文言だけを取り出す */
function errorMessagesOf(value: unknown): string[] {
  if (value === null || typeof value !== 'object') {
    return [];
  }
  const { errors } = value as { errors?: unknown };
  if (!Array.isArray(errors)) {
    return [];
  }
  return errors
    .map((error) => (error as { message?: unknown } | null)?.message)
    .filter((message): message is string => typeof message === 'string');
}

/**
 * 失敗を分類する。判断がつかないものは `retryable` に倒す。
 *
 * 取りこぼしても「次回また試す」だけで済むが、誤って `permanent` にすると
 * 読めるはずの記録が二度と対象に入らなくなる。損が小さいほうへ倒す
 */
function classifyFailure(value: unknown): LabelSpecsOutcome {
  const messages = errorMessagesOf(value);
  const permanent = messages.some((message) =>
    PERMANENT_FAILURE_MESSAGES.some((known) => message.includes(known)),
  );
  return permanent ? { status: 'permanent' } : { status: 'retryable' };
}

/**
 * 登録済みの画像から詳細スペックを読み取る。
 *
 * 記録が持っている S3 のキーをそのまま渡す。OCR Lambda はキーの先頭が自分の
 * Cognito sub かを見るだけなので、登録済みの画像も一時領域の画像と同じように
 * 解析できる（枚数の上限は Lambda 側で 3 枚に切られる）。
 *
 * **確信度の低い項目は落とす。** 登録時の OCR は入力欄に「要確認」を出して
 * 目視に委ねられるが、一括読み取りは人の目を経ずに保存まで進む。自信の無い
 * 読み取りをそのまま書き込むと、あとから見て何が正しいか分からなくなる。
 *
 * 戻り値は3種類を区別する（`LabelSpecsOutcome`）。解析が通れば `read`、
 * 失敗はやり直す価値で `retryable` と `permanent` に分かれる。一括読み取りが
 * 「次回もう一度投げるか」を決める判断がここで分かれる。
 *
 * 解析が通っても中身が空のことはある（読めなかった項目しか無かった場合）。
 * これは失敗ではなく `read` で、同じ画像なら何度呼んでも同じ結果になる。
 *
 * 銘柄名が読めない画像では、Lambda 側が他の項目も採用しない
 * （extractLabelInfo.ts）。裏ラベルだけの写真では空で返ることがある
 */
export async function requestLabelSpecs(imageKeys: string[]): Promise<LabelSpecsOutcome> {
  if (imageKeys.length === 0) {
    return { status: 'read', specs: {} };
  }

  try {
    const result = await client.graphql({
      query: analyzeSakeLabel,
      variables: {
        imageKey: imageKeys[0],
        additionalImageKeys: imageKeys.slice(1),
      },
    });

    if ('errors' in result && result.errors && result.errors.length > 0) {
      console.error('analyzeSakeLabel errors:', result.errors);
      return classifyFailure(result);
    }

    const data = (result as { data?: { analyzeSakeLabel?: AnalyzeResponse | null } }).data
      ?.analyzeSakeLabel;
    if (!data) {
      return { status: 'retryable' };
    }

    const confidence = data.fieldConfidence;
    return {
      status: 'read',
      specs: Object.fromEntries(
        SPEC_FIELD_NAMES.filter(
          (key) =>
            data[key] != null && (confidence?.[key] ?? 0) >= LOW_CONFIDENCE_THRESHOLD,
        ).map((key) => [key, data[key]]),
      ),
    };
  } catch (error) {
    console.error('analyzeSakeLabel failed:', error);
    // Amplify は GraphQL のエラーを例外として投げることもある。
    // 応答と同じ形（errors[]）が載っているので、同じ物差しで分類する
    return classifyFailure(error);
  }
}
