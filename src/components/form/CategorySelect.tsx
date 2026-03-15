import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SAKE_CATEGORIES } from '@/features/purchase/types';
import type { SakeCategory } from '@/features/purchase/types';

const CATEGORY_DISPLAY_NAMES: Record<SakeCategory, string> = {
  NIHONSHU: '日本酒',
  BEER: 'ビール',
  WINE: 'ワイン',
  WHISKY: 'ウイスキー',
  SHOCHU: '焼酎',
  OTHER: 'その他',
};

export { CATEGORY_DISPLAY_NAMES };

export function CategorySelect({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (value: string | null) => void;
  onBlur: () => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        data-testid="input-category"
        className="w-full"
        onBlur={onBlur}
      >
        <SelectValue placeholder="カテゴリを選択">
          {CATEGORY_DISPLAY_NAMES[value as SakeCategory]}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {SAKE_CATEGORIES.map((cat) => (
          <SelectItem key={cat} value={cat}>
            {CATEGORY_DISPLAY_NAMES[cat]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
