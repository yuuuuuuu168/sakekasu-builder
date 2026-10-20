import { format, parse } from 'date-fns';
import { DatePickerField } from './DatePickerField';

const ISO_DATE = 'yyyy-MM-dd';

interface IsoDateFieldProps {
  /** YYYY-MM-DD。未入力は空文字 */
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  testId?: string;
}

/** フォームが YYYY-MM-DD の文字列で持つ日付を、日付選択で入力する */
export function IsoDateField({ value, onChange, onBlur, testId }: IsoDateFieldProps) {
  const selected = value ? parse(value, ISO_DATE, new Date()) : undefined;
  return (
    <DatePickerField
      value={selected}
      onSelect={(date) => {
        if (date) onChange(format(date, ISO_DATE));
      }}
      onBlur={onBlur}
      testId={testId}
    />
  );
}
