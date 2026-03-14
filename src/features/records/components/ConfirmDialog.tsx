import { Dialog } from '@base-ui/react/dialog';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sakeName: string;
  recordType: 'purchase' | 'drinking';
  isDeleting: boolean;
  onConfirm: () => void;
}

const recordTypeLabel: Record<ConfirmDialogProps['recordType'], string> = {
  purchase: '購入',
  drinking: '飲酒',
};

export function ConfirmDialog({
  open,
  onOpenChange,
  sakeName,
  recordType,
  isDeleting,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isDeleting) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-card p-6 shadow-xl ring-1 ring-border data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
          <Dialog.Title className="text-lg font-semibold text-card-foreground">
            記録の削除
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">
            「{sakeName}」の{recordTypeLabel[recordType]}記録を削除しますか？この操作は取り消せません。
          </Dialog.Description>
          <div className="mt-6 flex justify-end gap-3">
            <Dialog.Close
              render={
                <Button variant="outline" disabled={isDeleting}>
                  キャンセル
                </Button>
              }
            />
            <Button
              variant="destructive"
              disabled={isDeleting}
              onClick={onConfirm}
            >
              {isDeleting && <Loader2 className="size-4 animate-spin" />}
              削除する
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
