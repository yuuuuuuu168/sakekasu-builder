import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface DeleteButtonProps {
  onClick: () => void;
  disabled: boolean;
}

export function DeleteButton({ onClick, disabled }: DeleteButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="削除"
      disabled={disabled}
      onClick={onClick}
      className="text-muted-foreground hover:text-danger"
    >
      <Trash2 className="size-4" />
    </Button>
  );
}
