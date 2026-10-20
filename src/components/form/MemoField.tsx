import { Textarea } from '@/components/ui/textarea';
import { FormField } from './FormField';

interface MemoFieldProps {
  value: string;
  onChange: (value: string) => void;
}

/** 購入・飲酒フォームのメモ欄（任意） */
export function MemoField({ value, onChange }: MemoFieldProps) {
  return (
    <FormField label="メモ">
      <Textarea
        data-testid="input-memo"
        placeholder="味の感想やメモなど（任意）"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
      />
    </FormField>
  );
}
