import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { SakeCategory } from '@/features/purchase/types';
import {
  specFieldsForCategory,
  type SakeSpecFormData,
  type SpecFieldDef,
  type SpecFieldName,
  type SpecValidationErrors,
} from '../types';
import { hasAnySpecValue } from '../lib/sakeSpecs';

interface SakeSpecFieldsProps {
  specs: SakeSpecFormData;
  errors: SpecValidationErrors;
  /** 表示する項目を決めるためのカテゴリ（日本酒向けの項目は日本酒のときだけ出す） */
  category: SakeCategory;
  onChange: (field: SpecFieldName, value: string) => void;
  onBlur: (field: SpecFieldName) => void;
  disabled?: boolean;
  /** OCR が低い確信度で埋めた項目。ラベルに「要確認」を添える */
  lowConfidenceFields?: SpecFieldName[];
}

/**
 * 詳細スペックの入力欄（Issue #87）。
 *
 * 既定では折りたたんでおく。銘柄名だけ書いて済ませたい人の入力体験を壊さずに、
 * 書きたい人は開いて埋められるようにする。
 *
 * 入力済みの項目があるとき（編集や OCR の読み取り結果が入ったとき）と、
 * 入力エラーがあるときは開いた状態で出す。閉じたままだと直す場所が見えない
 */
export function SakeSpecFields({
  specs,
  errors,
  category,
  onChange,
  onBlur,
  disabled,
  lowConfidenceFields,
}: SakeSpecFieldsProps) {
  const fields = specFieldsForCategory(category);
  const filledCount = fields.filter((field) => specs[field.key].trim() !== '').length;
  const hasError = Object.keys(errors).length > 0;

  // 開閉はユーザーの操作を優先し、まだ触っていない間だけ中身から決める
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const isOpen = manualOpen ?? (hasAnySpecValue(specs) || hasError);

  return (
    <div className="rounded-lg border border-border/60" data-testid="sake-spec-fields">
      <button
        type="button"
        onClick={() => setManualOpen(!isOpen)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
        data-testid="spec-accordion-toggle"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          詳細スペック（任意）
          {filledCount > 0 && (
            <span
              className="rounded-full bg-sake-gold/15 px-2 py-0.5 text-xs font-semibold text-sake-gold"
              data-testid="spec-filled-count"
            >
              {filledCount}件入力済み
            </span>
          )}
        </span>
        <ChevronDown
          className={`size-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-3 border-t border-border/60 px-3 py-3">
              {fields.map((field) => (
                <SpecField
                  key={field.key}
                  field={field}
                  value={specs[field.key]}
                  error={errors[field.key]}
                  onChange={(value) => onChange(field.key, value)}
                  onBlur={() => onBlur(field.key)}
                  disabled={disabled}
                  needsCheck={lowConfidenceFields?.includes(field.key) ?? false}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SpecField({
  field,
  value,
  error,
  onChange,
  onBlur,
  disabled,
  needsCheck,
}: {
  field: SpecFieldDef;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  disabled?: boolean;
  needsCheck: boolean;
}) {
  const testId = `input-spec-${field.key}`;

  return (
    <div className="space-y-1">
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {field.label}
        {needsCheck && (
          <span
            className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
            data-testid={`spec-low-confidence-${field.key}`}
          >
            要確認
          </span>
        )}
      </label>

      {field.kind === 'textarea' ? (
        <Textarea
          data-testid={testId}
          placeholder={field.placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          maxLength={field.maxLength}
          rows={2}
          disabled={disabled}
          aria-invalid={!!error}
        />
      ) : (
        <div className="relative">
          <Input
            data-testid={testId}
            type={field.kind === 'number' ? 'number' : 'text'}
            inputMode={field.kind === 'number' ? 'decimal' : undefined}
            step={field.step}
            min={field.min}
            max={field.max}
            maxLength={field.kind === 'text' ? field.maxLength : undefined}
            placeholder={field.placeholder}
            className={field.unit ? 'pr-10' : undefined}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            disabled={disabled}
            aria-invalid={!!error}
          />
          {field.unit && (
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              {field.unit}
            </span>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive" data-testid={`error-spec-${field.key}`}>
          {error}
        </p>
      )}
    </div>
  );
}
