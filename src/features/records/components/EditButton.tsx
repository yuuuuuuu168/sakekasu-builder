import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface EditButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export function EditButton({ onClick, disabled }: EditButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="編集"
      disabled={disabled}
      onClick={onClick}
      className="text-gray-400 hover:text-sake-gold dark:text-gray-500 dark:hover:text-dark-gold"
    >
      <Pencil className="size-4" />
    </Button>
  );
}
