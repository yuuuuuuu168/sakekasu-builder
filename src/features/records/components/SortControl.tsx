import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SORT_OPTIONS, type SortOption } from '../types';

interface SortControlProps {
  sortOption: SortOption;
  onSortChange: (option: SortOption) => void;
}

export function SortControl({ sortOption, onSortChange }: SortControlProps) {
  const sortLabel = SORT_OPTIONS.find(
    (opt) => opt.value === sortOption
  )?.label;

  return (
    <div className="flex flex-col gap-1.5 min-w-[140px]">
      <label className="text-xs text-muted-foreground">並び替え</label>
      <Select
        value={sortOption}
        onValueChange={(val) => onSortChange(val as SortOption)}
      >
        <SelectTrigger
          className="w-full min-h-[44px] text-sm"
          data-testid="sort-option"
        >
          <SelectValue placeholder="日付（新しい順）">{sortLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
