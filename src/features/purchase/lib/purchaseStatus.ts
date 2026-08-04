import { generateClient } from 'aws-amplify/api';
import { updatePurchaseRecord } from '@/graphql/mutations';

const client = generateClient();

/**
 * 購入記録を「飲み中」にし、開封日時を現在時刻で記録する。
 *
 * 在庫から飲酒記録を登録したときに呼ぶ。飲酒記録の登録自体は成功しているため、
 * 失敗しても例外は投げず false を返す（呼び出し元で通知の出し分けに使う）。
 */
export async function markPurchaseAsInProgress(id: string): Promise<boolean> {
  try {
    await client.graphql({
      query: updatePurchaseRecord,
      variables: {
        input: {
          id,
          drinkingStatus: 'IN_PROGRESS',
          openedAt: new Date().toISOString(),
        },
      },
    });
    return true;
  } catch (error) {
    console.error('Failed to mark purchase as in progress:', error);
    return false;
  }
}
