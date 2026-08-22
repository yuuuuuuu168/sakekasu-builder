import { generateClient } from 'aws-amplify/api';
import { updatePurchaseRecord } from '@/graphql/mutations';

const client = generateClient();

/**
 * 購入記録の備考だけを書き換える。
 *
 * 一括追記で使う。フォーム経由の更新（usePurchaseStorage.updatePurchase）は
 * 全項目を送るので、画面に出していない記録へ使うと、取得漏れの項目を
 * 空で上書きしかねない。更新式は渡した項目だけを SET するため、
 * memo だけを送れば他は元のまま残る。
 *
 * 成功したかどうかだけを返す（失敗の理由は呼び出し側で使わないため）
 */
export async function updateRecordMemo(id: string, memo: string): Promise<boolean> {
  try {
    const result = await client.graphql({
      query: updatePurchaseRecord,
      variables: { input: { id, memo } },
    });

    if ('errors' in result && result.errors && result.errors.length > 0) {
      console.error('PurchaseRecord memo update errors:', result.errors);
      return false;
    }

    return true;
  } catch (error) {
    console.error('PurchaseRecord memo update failed:', error);
    return false;
  }
}
