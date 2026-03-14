import { useState, useCallback } from 'react';
import { generateClient } from 'aws-amplify/api';
import { toast } from 'sonner';
import { deletePurchaseRecord, deleteDrinkingRecord } from '@/graphql/mutations';
import type { RecordType, UnifiedRecord } from '../types';

const client = generateClient();

export interface UseDeleteRecordReturn {
  deleteRecord: (id: string, type: RecordType) => Promise<void>;
  isDeleting: boolean;
}

export function useDeleteRecord(
  records: UnifiedRecord[],
  onOptimisticRemove: (id: string) => void,
  onRollback: (record: UnifiedRecord) => void,
  onSuccess: () => void,
): UseDeleteRecordReturn {
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteRecord = useCallback(
    async (id: string, type: RecordType) => {
      const record = records.find((r) => r.id === id);
      if (!record) return;

      setIsDeleting(true);
      onOptimisticRemove(id);

      try {
        const mutation =
          type === 'purchase' ? deletePurchaseRecord : deleteDrinkingRecord;

        await client.graphql({
          query: mutation,
          variables: { id },
        });

        onSuccess();
      } catch {
        onRollback(record);
        toast.error('削除に失敗しました。もう一度お試しください。');
      } finally {
        setIsDeleting(false);
      }
    },
    [records, onOptimisticRemove, onRollback, onSuccess],
  );

  return { deleteRecord, isDeleting };
}
