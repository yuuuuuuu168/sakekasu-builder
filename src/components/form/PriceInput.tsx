import { Input } from '@/components/ui/input';

interface PriceInputProps {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  invalid: boolean;
}

/** 先頭に ¥ を付けた価格の入力欄 */
export function PriceInput({ value, onChange, onBlur, invalid }: PriceInputProps) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        ¥
      </span>
      <Input
        data-testid="input-price"
        type="number"
        min="0"
        placeholder="0"
        className="pl-7"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={invalid}
      />
    </div>
  );
}
