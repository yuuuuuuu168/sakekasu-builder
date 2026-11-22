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
      className="text-muted-foreground hover:text-foreground"
    >
      <Pencil className="size-4" />
    </Button>
  );
}
