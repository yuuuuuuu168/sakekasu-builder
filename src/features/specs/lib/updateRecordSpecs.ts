import { generateClient } from 'aws-amplify/api';
import { updatePurchaseRecord, updateDrinkingRecord } from '@/graphql/mutations';
import type { RecordType } from '@/features/records/types';
import { SPEC_FIELD_NAMES, type SakeSpecs } from '../types';

const client = generateClient();

/**
 * 記録の詳細スペックだけを書き換える。
 *
 * 一括読み取りで使う。フォーム経由の更新（usePurchaseStorage.updatePurchase）は
 * 全項目を送るので、画面に出していない記録へ使うと取得漏れの項目を空で
 * 上書きしかねない。更新式は渡した項目だけを SET するため、埋める項目だけを
 * 送れば他は元のまま残る。
 *
 * 既定では**値の無い項目を送らない**。ここで null を送ると、利用者が手で入れた値まで
 * 消える。空欄で消せるのはフォームから明示的に消したときだけにする
 * （usePurchaseStorage の specsToUpdateInput がその役目を持つ）。
 *
 * `replace` を渡したときだけ、読み取れなかった項目に null を送って丸ごと
 * 入れ替える。写真から読み直して以前の値を正すための口で、間違って書き込まれた
 * 値が残らないようにする
 *
 * 成功したかどうかだけを返す（失敗の理由は呼び出し側で使わないため）
 */
export async function updateRecordSpecs(
  id: string,
  type: RecordType,
  specs: Partial<SakeSpecs>,
  { replace = false }: { replace?: boolean } = {},
): Promise<boolean> {
  const filled = replace
    ? Object.fromEntries(SPEC_FIELD_NAMES.map((key) => [key, specs[key] ?? null]))
    : Object.fromEntries(Object.entries(specs).filter(([, value]) => value != null));

  if (Object.keys(filled).length === 0) {
    return false;
  }

  const query = type === 'purchase' ? updatePurchaseRecord : updateDrinkingRecord;

  try {
    const result = await client.graphql({
      query,
      variables: { input: { id, ...filled } },
    });

    if ('errors' in result && result.errors && result.errors.length > 0) {
      console.error('Record specs update errors:', result.errors);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Record specs update failed:', error);
    return false;
  }
}
