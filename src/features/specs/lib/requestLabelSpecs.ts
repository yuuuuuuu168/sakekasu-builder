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
 * 戻り値は2種類を区別する。呼び出しそのものが失敗したときは `null`、
 * 解析はできたが読み取れなかったときは中身が空のスペック。前者はやり直せば
 * 結果が変わりうるが、後者は同じ画像なら何度呼んでも同じで、一括読み取りが
 * 「読めなかった記録」を控えるかどうかの判断がここで分かれる。
 *
 * 銘柄名が読めない画像では、Lambda 側が他の項目も採用しない
 * （extractLabelInfo.ts）。裏ラベルだけの写真では空で返ることがある
 */
export async function requestLabelSpecs(
  imageKeys: string[],
): Promise<Partial<SakeSpecs> | null> {
  if (imageKeys.length === 0) {
    return {};
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
      return null;
    }

    const data = (result as { data?: { analyzeSakeLabel?: AnalyzeResponse | null } }).data
      ?.analyzeSakeLabel;
    if (!data) {
      return null;
    }

    const confidence = data.fieldConfidence;
    return Object.fromEntries(
      SPEC_FIELD_NAMES.filter(
        (key) =>
          data[key] != null && (confidence?.[key] ?? 0) >= LOW_CONFIDENCE_THRESHOLD,
      ).map((key) => [key, data[key]]),
    );
  } catch (error) {
    console.error('analyzeSakeLabel failed:', error);
    return null;
  }
}
