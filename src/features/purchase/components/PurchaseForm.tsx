import { useEffect } from 'react';
import { format, parse } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

import { FormField } from '@/components/form/FormField';
import { DatePickerField } from '@/components/form/DatePickerField';
import { CategorySelect } from '@/components/form/CategorySelect';

import { usePurchaseForm } from '@/features/purchase/hooks/usePurchaseForm';
import { ImageUploadArea } from '@/features/image/components/ImageUploadArea';
import { useOcrTrigger } from '@/features/image/hooks/useOcrTrigger';

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

  const { handleOcrTrigger, isAnalyzing, ocrMessage, resetOcr } = useOcrTrigger(
    imageUpload,
    'purchase',
    (sakeName) => handleChange('sakeName', sakeName),
  );

  const isSubmitting = isSaving || imageUpload.isUploading || isAnalyzing;

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
      {/* 画像添付 */}
      <FormField label="画像（任意）">
        <ImageUploadArea
          imageFile={imageUpload.imageFile}
          onImageChange={(file) => {
            if (file) {
              imageUpload.handleImageSelect(file);
            } else {
              imageUpload.clearImage();
              resetOcr();
            }
          }}
          isCompressing={imageUpload.isCompressing}
          isUploading={imageUpload.isUploading}
          error={imageUpload.error}
          disabled={isSubmitting}
          isOcrAnalyzing={isAnalyzing}
          onOcrTrigger={handleOcrTrigger}
          ocrMessage={ocrMessage}
        />
      </FormField>

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
          testId="input-purchaseDate"
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
