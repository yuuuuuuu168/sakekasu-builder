import { useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface FinishBottlesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sakeName: string;
  /** まだ飲みきっていない本数 */
  remaining: number;
  isUpdating: boolean;
  /** 飲みきった本数を確定する */
  onConfirm: (bottles: number) => void;
}

/**
 * まとめ買いした記録を飲みきるときに、何本ぶんかを聞くダイアログ（Issue #159）。
 *
 * 残り1本の記録では出さない（本数を聞くまでもない）。箱ごと飲みきったときのために
 * 残り本数までまとめて指定できるようにしてある。
 *
 * 入力値は開いている間だけ持つ。呼び出し側が開くたびにマウントし直すので、
 * 前回の本数は残らない。
 */
export function FinishBottlesDialog({
  open,
  onOpenChange,
  sakeName,
  remaining,
  isUpdating,
  onConfirm,
}: FinishBottlesDialogProps) {
  // 入力途中の空文字を許すため文字列で持つ
  const [value, setValue] = useState('1');

  const bottles = Number.parseInt(value, 10);
  const isValid = Number.isInteger(bottles) && bottles >= 1 && bottles <= remaining;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        // 更新中に閉じられると、押した本数と画面がずれる
        if (isUpdating) return;
        onOpenChange(nextOpen);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <Dialog.Popup
          className="fixed top-1/2 left-1/2 z-50 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-card p-6 shadow-xl ring-1 ring-border data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          data-testid="finish-bottles-dialog"
        >
          <Dialog.Title className="text-lg font-semibold text-card-foreground">
            何本飲みきった？
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">
            「{sakeName}」は残り{remaining}本です。飲みきったぶんだけ在庫から減らします。
          </Dialog.Description>

          <div className="mt-4 flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={remaining}
              step={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={isUpdating}
              aria-label="飲みきった本数"
              data-testid="finish-bottles-input"
              className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-sake-gold/50"
            />
            <span className="text-sm text-muted-foreground">本</span>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <Dialog.Close
              render={
                <Button variant="outline" disabled={isUpdating}>
                  キャンセル
                </Button>
              }
            />
            <Button
              disabled={isUpdating || !isValid}
              onClick={() => onConfirm(bottles)}
              data-testid="finish-bottles-confirm"
            >
              {isUpdating && <Loader2 className="size-4 animate-spin" />}
              飲みきりにする
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
