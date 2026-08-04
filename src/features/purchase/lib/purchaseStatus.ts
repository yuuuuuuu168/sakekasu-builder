import { generateClient } from 'aws-amplify/api';
import { markPurchaseOpened } from '@/graphql/mutations';
import type { PurchaseRecordType } from '@/types/schema';

const client = generateClient();

/**
 * 開封処理の結果。
 * - `opened`: 未開封だったので「飲み中」にした
 * - `unchanged`: すでに開封済み（または自分の記録ではない）ため何も変えていない
 * - `failed`: 通信エラーなどで実行できなかった
 */
export type MarkPurchaseOpenedResult = 'opened' | 'unchanged' | 'failed';

interface MarkPurchaseOpenedResponse {
  markPurchaseOpened: PurchaseRecordType | null;
}

/**
 * 購入記録を「飲み中」にし、開封日時を記録する。
 *
 * 未開封かどうかの判定はサーバ側の条件式で行うため、再送・二重送信・端末間のズレが
 * あっても開封日時が上書きされることはない。すでに開封済みなら `unchanged` が返る。
 *
 * 飲酒記録の登録自体は成功しているので、失敗しても例外は投げない。
 */
export async function markPurchaseAsInProgress(id: string): Promise<MarkPurchaseOpenedResult> {
  try {
    const response = (await client.graphql({
      query: markPurchaseOpened,
      variables: { id },
    })) as { data?: MarkPurchaseOpenedResponse };

    return response.data?.markPurchaseOpened ? 'opened' : 'unchanged';
  } catch (error) {
    console.error('Failed to mark purchase as opened:', error);
    return 'failed';
  }
}
