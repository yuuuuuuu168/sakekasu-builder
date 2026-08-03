import { useState } from 'react';
import { generateClient } from 'aws-amplify/api';
import { updatePurchaseRecord } from '@/graphql/mutations';
import type { DrinkingStatus } from '@/types/schema';
import { toast } from 'sonner';

const client = generateClient();

interface UseUpdateDrinkingStatusReturn {
  updateStatus: (id: string, newStatus: DrinkingStatus) => Promise<void>;
  isUpdating: boolean;
}

/**
 * ステータス遷移に応じた openedAt の更新値を返す。
 * undefined は「変更しない」（FINISHED 遷移時は開封日時を保持する）。
 */
function getOpenedAtUpdate(newStatus: DrinkingStatus): string | null | undefined {
  switch (newStatus) {
    case 'IN_PROGRESS':
      return new Date().toISOString();
    case 'NOT_STARTED':
      return null;
    case 'FINISHED':
      return undefined;
  }
}

export function useUpdateDrinkingStatus(
  onOptimisticUpdate: (id: string, newStatus: DrinkingStatus, openedAtUpdate?: string | null) => void,
  onRollback: (id: string, oldStatus: DrinkingStatus) => void,
): UseUpdateDrinkingStatusReturn {
  const [isUpdating, setIsUpdating] = useState(false);

  const updateStatus = async (id: string, newStatus: DrinkingStatus) => {
    setIsUpdating(true);

    const openedAtUpdate = getOpenedAtUpdate(newStatus);

    // 現在のステータスをロールバック用に推定（呼び出し元で管理）
    onOptimisticUpdate(id, newStatus, openedAtUpdate);

    try {
      await client.graphql({
        query: updatePurchaseRecord,
        variables: {
          input: {
            id,
            drinkingStatus: newStatus,
            ...(openedAtUpdate !== undefined && { openedAt: openedAtUpdate }),
          },
        },
      });
      toast.success('ステータスを更新しました');
    } catch (error) {
      console.error('Failed to update drinking status:', error);
      // ロールバックは呼び出し元に委任
      const oldStatus = getReversedStatus(newStatus);
      onRollback(id, oldStatus);
      toast.error('ステータスの更新に失敗しました');
    } finally {
      setIsUpdating(false);
    }
  };

  return { updateStatus, isUpdating };
}

/** ステータス遷移を戻すためのヘルパー（ロールバック時の推測用） */
function getReversedStatus(status: DrinkingStatus): DrinkingStatus {
  switch (status) {
    case 'IN_PROGRESS':
      return 'NOT_STARTED';
    case 'FINISHED':
      return 'IN_PROGRESS';
    case 'NOT_STARTED':
      return 'IN_PROGRESS';
  }
}
