import { useId } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface FilterSelectOption<T extends string> {
  value: T;
  label: string;
}

interface FilterSelectProps<T extends string> {
  /** 見出し。トリガーに htmlFor で結び付けるので、読み上げと getByLabelText で拾える */
  label: string;
  value: T;
  options: readonly FilterSelectOption<T>[];
  onChange: (value: T) => void;
  testId: string;
  placeholder?: string;
}

/**
 * 選択が外れたとき（null）は何もしない。
 *
 * base-ui の Select は、選ばれている項目をもう一度押すと解除として null を
 * 渡してくる。そのまま絞り込みへ入れると、どの条件にも一致しなくなって
 * 記録が1件も出なくなる。解除は「操作なし」として扱い、今の絞り込みを残す
 */
function onlyWhenSelected<T>(handler: (value: T) => void) {
  return (value: string | null) => {
    if (value !== null) {
      handler(value as T);
    }
  };
}

/**
 * 絞り込み条件1つ分の見出し付きセレクト。
 *
 * 記録一覧の条件はどれも「見出し + 選択肢から1つ選ぶ」の同じ形なので、
 * 見た目と null の扱いをここにまとめる
 */
export function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
  placeholder = 'すべて',
}: FilterSelectProps<T>) {
  const id = useId();
  const selectedLabel = options.find((opt) => opt.value === value)?.label;

  return (
    <div className="flex flex-col gap-1.5 min-w-[120px] flex-1">
      <label className="text-xs text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      <Select value={value} onValueChange={onlyWhenSelected<T>(onChange)}>
        <SelectTrigger
          id={id}
          className="w-full min-h-[44px] text-sm"
          data-testid={testId}
        >
          <SelectValue placeholder={placeholder}>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
