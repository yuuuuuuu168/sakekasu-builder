import { useState } from 'react';
import { generateClient } from 'aws-amplify/api';
import { updatePurchaseRecord } from '@/graphql/mutations';
import type { DrinkingStatus } from '@/types/schema';
import type { UnifiedRecord } from '../types';
import { getRemainingBottles, planStatusChange } from '../lib/bottleCount';
import { toast } from 'sonner';

const client = generateClient();

interface UseUpdateDrinkingStatusReturn {
  /**
   * 購入記録のステータスを動かす。
   * bottles は飲みきる本数（飲みきりへ進めるときだけ意味を持つ）。
   */
  updateStatus: (record: UnifiedRecord, newStatus: DrinkingStatus, bottles?: number) => Promise<void>;
  isUpdating: boolean;
}

/**
 * 飲みきりステータスの更新。
 *
 * まとめ買いした記録では、飲みきり操作が「1本ぶん減らす」意味になる（Issue #159）。
 * 残本数がまだあるなら記録は未開封へ戻り、0本になったときだけ飲みきりになる。
 * 何をどう書き換えるかの判断は bottleCount.ts の純粋関数に置いてある。
 *
 * patchRecord は一覧の楽観的更新に使う。失敗したら操作前の値をそのまま書き戻す
 * （更新前の記録を受け取っているので、戻す値を推測しなくてよい）。
 */
export function useUpdateDrinkingStatus(
  patchRecord: (id: string, patch: Partial<UnifiedRecord>) => void,
): UseUpdateDrinkingStatusReturn {
  const [isUpdating, setIsUpdating] = useState(false);

  const updateStatus = async (record: UnifiedRecord, newStatus: DrinkingStatus, bottles?: number) => {
    setIsUpdating(true);

    const update = planStatusChange(record, newStatus, { bottles, now: new Date().toISOString() });
    const previous: Partial<UnifiedRecord> = {
      drinkingStatus: record.drinkingStatus,
      remainingQuantity: record.remainingQuantity,
      openedAt: record.openedAt,
    };

    patchRecord(record.id, {
      drinkingStatus: update.drinkingStatus,
      remainingQuantity: update.remainingQuantity,
      ...(update.openedAt !== undefined && { openedAt: update.openedAt }),
    });

    try {
      await client.graphql({
        query: updatePurchaseRecord,
        variables: {
          input: {
            id: record.id,
            drinkingStatus: update.drinkingStatus,
            remainingQuantity: update.remainingQuantity,
            ...(update.openedAt !== undefined && { openedAt: update.openedAt }),
          },
        },
      });
      toast.success(getSuccessMessage(record, update.drinkingStatus, update.remainingQuantity));
    } catch (error) {
      console.error('Failed to update drinking status:', error);
      patchRecord(record.id, previous);
      toast.error('ステータスの更新に失敗しました');
    } finally {
      setIsUpdating(false);
    }
  };

  return { updateStatus, isUpdating };
}

/**
 * 完了メッセージ。
 * まとめ買いを1本ずつ飲んだときは、残りが何本になったかまで伝える
 * （画面上はステータスが未開封へ戻るだけなので、減ったことが分かりにくい）
 */
function getSuccessMessage(
  record: UnifiedRecord,
  nextStatus: DrinkingStatus,
  remaining: number,
): string {
  const finished = getRemainingBottles(record) - remaining;
  if (finished > 0 && nextStatus !== 'FINISHED') {
    return `${finished}本を飲みきりました。残り${remaining}本です`;
  }
  return 'ステータスを更新しました';
}
