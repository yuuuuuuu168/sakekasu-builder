import { useEffect } from 'react';
import { format, parse } from 'date-fns';
import { ja } from 'date-fns/locale/ja';
import { CalendarIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';

import { usePurchaseForm } from '@/features/purchase/hooks/usePurchaseForm';
import { ImageUploadArea } from '@/features/image/components/ImageUploadArea';
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

const MotionButton = motion.create(Button);

interface PurchaseFormProps {
  onSubmitSuccess?: () => void;
}

export function PurchaseForm({ onSubmitSuccess }: PurchaseFormProps) {
  const {
    formData,
    errors,
    isSaving,
    submitResult,
    handleChange,
    handleBlur,
    handleSubmit,
    imageUpload,
  } = usePurchaseForm();

  const isSubmitting = isSaving || imageUpload.isUploading;

  useEffect(() => {
    if (!submitResult) return;
    if (submitResult.success) {
      toast.success('登録が完了しました');
      onSubmitSuccess?.();
    } else {
      toast.error(submitResult.error ?? '登録に失敗しました。もう一度お試しください');
    }
  }, [submitResult, onSubmitSuccess]);

  const selectedDate = formData.purchaseDate
    ? parse(formData.purchaseDate, 'yyyy-MM-dd', new Date())
    : undefined;

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      handleChange('purchaseDate', format(date, 'yyyy-MM-dd'));
    }
  };

  const onFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSubmit();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
    <form onSubmit={onFormSubmit} className="space-y-5" data-testid="purchase-form">
      {/* 銘柄名 */}
      <FormField label="銘柄名" error={errors.sakeName} required>
        <Input
          data-testid="input-sakeName"
          placeholder="例: 獺祭 純米大吟醸"
          value={formData.sakeName}
          onChange={(e) => handleChange('sakeName', e.target.value)}
          onBlur={() => handleBlur('sakeName')}
          aria-invalid={!!errors.sakeName}
        />
      </FormField>

      {/* 購入店舗 */}
      <FormField label="購入店舗" error={errors.storeName} required>
        <Input
          data-testid="input-storeName"
          placeholder="例: 酒のやまや 渋谷店"
          value={formData.storeName}
          onChange={(e) => handleChange('storeName', e.target.value)}
          onBlur={() => handleBlur('storeName')}
          aria-invalid={!!errors.storeName}
        />
      </FormField>

      {/* 購入価格 */}
      <FormField label="購入価格" error={errors.price} required>
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
            value={formData.price}
            onChange={(e) => handleChange('price', e.target.value)}
            onBlur={() => handleBlur('price')}
            aria-invalid={!!errors.price}
          />
        </div>
      </FormField>

      {/* 購入日 */}
      <FormField label="購入日" error={errors.purchaseDate} required>
        <DatePickerField
          value={selectedDate}
          onSelect={handleDateSelect}
          onBlur={() => handleBlur('purchaseDate')}
        />
      </FormField>

      {/* カテゴリ */}
      <FormField label="カテゴリ" error={errors.category} required>
        <CategorySelect
          value={formData.category}
          onChange={(val) => { if (val !== null) handleChange('category', val); }}
          onBlur={() => handleBlur('category')}
        />
      </FormField>

      {/* メモ */}
      <FormField label="メモ">
        <Textarea
          data-testid="input-memo"
          placeholder="味の感想やメモなど（任意）"
          value={formData.memo}
          onChange={(e) => handleChange('memo', e.target.value)}
          rows={3}
        />
      </FormField>

      {/* 画像添付 */}
      <FormField label="画像（任意）">
        <ImageUploadArea
          imageFile={imageUpload.imageFile}
          onImageChange={(file) => {
            if (file) {
              imageUpload.handleImageSelect(file);
            } else {
              imageUpload.clearImage();
            }
          }}
          isCompressing={imageUpload.isCompressing}
          isUploading={imageUpload.isUploading}
          error={imageUpload.error}
          disabled={isSubmitting}
        />
      </FormField>

      {/* 登録ボタン */}
      <MotionButton
        type="submit"
        data-testid="submit-button"
        disabled={isSubmitting}
        className="w-full h-10 text-base font-semibold"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            {imageUpload.isUploading ? '画像アップロード中...' : '登録中...'}
          </>
        ) : (
          '🍶 登録する'
        )}
      </MotionButton>
    </form>
    </motion.div>
  );
}


/* ─── Sub-components ─── */

function FormField({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
      <AnimatePresence>
        {error && (
          <motion.p
            data-testid={`error-${label}`}
            className="text-xs text-destructive"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function DatePickerField({
  value,
  onSelect,
  onBlur,
}: {
  value: Date | undefined;
  onSelect: (date: Date | undefined) => void;
  onBlur: () => void;
}) {
  const displayText = value
    ? format(value, 'yyyy年MM月dd日', { locale: ja })
    : '日付を選択';

  return (
    <Popover>
      <PopoverTrigger
        data-testid="input-purchaseDate"
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

function CategorySelect({
  value,
  onChange,
  onBlur,
}: {
  value: SakeCategory;
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
          {CATEGORY_DISPLAY_NAMES[value]}
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
