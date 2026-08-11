import { Dialog } from '@base-ui/react/dialog';
import { PurchaseForm } from '@/features/purchase/components/PurchaseForm';
import { DrinkingForm } from '@/features/drinking/components/DrinkingForm';
import type { UnifiedRecord } from '../types';
import {
  unifiedToPurchaseFormData,
  unifiedToDrinkingFormData,
} from '../lib/recordToFormData';

export interface EditRecordDialogProps {
  /** 編集対象の記録。null のときダイアログは閉じる */
  record: UnifiedRecord | null;
  onOpenChange: (open: boolean) => void;
  /** 更新成功時のコールバック（一覧の再取得などに使う） */
  onUpdated: () => void;
}

export function EditRecordDialog({ record, onOpenChange, onUpdated }: EditRecordDialogProps) {
  const isPurchase = record?.type === 'purchase';

  const handleSuccess = () => {
    onUpdated();
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={record !== null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-card p-6 shadow-xl ring-1 ring-border data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
          <Dialog.Title className="mb-4 text-lg font-semibold text-card-foreground">
            {isPurchase ? '🛒 購入記録を編集' : '🍶 飲酒記録を編集'}
          </Dialog.Title>

          {/* record が確定してからフォームを描画（初期値プリフィルのため key で再マウント） */}
          {record && isPurchase && (
            <PurchaseForm
              key={record.id}
              recordId={record.id}
              initialData={unifiedToPurchaseFormData(record)}
              existingImageKey={record.imageKey}
              existingImageKeys={record.imageKeys}
              onSubmitSuccess={handleSuccess}
            />
          )}
          {record && !isPurchase && (
            <DrinkingForm
              key={record.id}
              recordId={record.id}
              initialData={unifiedToDrinkingFormData(record)}
              existingImageKey={record.imageKey}
              existingImageKeys={record.imageKeys}
              onSubmitSuccess={handleSuccess}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
