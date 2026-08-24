import { generateClient } from 'aws-amplify/api';
import { analyzeSakeLabel } from '@/graphql/mutations';
import { SPEC_FIELD_NAMES, type SakeSpecs } from '../types';

const client = generateClient();

/** 解析結果のうち、この関数が見る部分 */
type AnalyzeResponse = Partial<SakeSpecs> & { sakeName: string | null };

/**
 * 登録済みの画像から詳細スペックを読み取る。
 *
 * 記録が持っている S3 のキーをそのまま渡す。OCR Lambda はキーの先頭が自分の
 * Cognito sub かを見るだけなので、登録済みの画像も一時領域の画像と同じように
 * 解析できる（枚数の上限は Lambda 側で 3 枚に切られる）。
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

    return Object.fromEntries(
      SPEC_FIELD_NAMES.filter((key) => data[key] != null).map((key) => [key, data[key]]),
    );
  } catch (error) {
    console.error('analyzeSakeLabel failed:', error);
    return null;
  }
}
