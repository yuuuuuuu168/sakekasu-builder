import { format } from 'date-fns';
import { ja } from 'date-fns/locale/ja';
import { CalendarIcon } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';

export function DatePickerField({
  value,
  onSelect,
  onBlur,
  testId,
}: {
  value: Date | undefined;
  onSelect: (date: Date | undefined) => void;
  onBlur: () => void;
  testId?: string;
}) {
  const displayText = value
    ? format(value, 'yyyy年MM月dd日', { locale: ja })
    : '日付を選択';

  return (
    <Popover>
      <PopoverTrigger
        data-testid={testId}
        className="flex h-8 w-full items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        onBlur={onBlur}
      >
        <CalendarIcon className="size-4 text-muted-foreground" />
        <span className={value ? 'text-foreground' : 'text-muted-foreground'}>
          {displayText}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={onSelect}
          disabled={{ after: new Date() }}
          locale={ja}
          defaultMonth={value}
        />
      </PopoverContent>
    </Popover>
  );
}
