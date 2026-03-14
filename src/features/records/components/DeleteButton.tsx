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
      className="text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400"
    >
      <Trash2 className="size-4" />
    </Button>
  );
}
