import { generateClient } from 'aws-amplify/api';
import { copyImages } from '@/graphql/mutations';

const client = generateClient();

interface CopyImagesResponse {
  copyImages: string[];
}

/**
 * 別の記録の画像を、指定した記録のものとして複製する。
 *
 * 「在庫から飲む」で購入記録の写真を飲酒記録へ引き継ぐのに使う。
 * キーの文字列をそのまま使い回すと、片方の記録を削除したときに
 * S3 の実体が消えてもう片方の画像まで見えなくなるため、
 * サーバー側で実体ごと複製して新しいキーを受け取る。
 *
 * 失敗しても記録の登録自体は続けたいので、呼び出し側で握って空配列を使う。
 */
export async function copyRecordImages(
  sourceKeys: string[],
  recordType: 'purchase' | 'drinking',
  recordId: string,
): Promise<string[]> {
  if (sourceKeys.length === 0) {
    return [];
  }

  const result = await client.graphql({
    query: copyImages,
    variables: { sourceKeys, recordType, recordId },
  });

  return (result as { data: CopyImagesResponse }).data.copyImages;
}
