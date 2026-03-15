import { useEffect } from 'react';
import { format, parse } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

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

import { FormField } from '@/components/form/FormField';
import { DatePickerField } from '@/components/form/DatePickerField';
import { CategorySelect } from '@/components/form/CategorySelect';

import { useDrinkingForm } from '../hooks/useDrinkingForm';
import { StarRating } from './StarRating';
import { ImageUploadArea } from '@/features/image/components/ImageUploadArea';
import { useOcrTrigger } from '@/features/image/hooks/useOcrTrigger';
import { getDrinkingMethodsByCategory, categoryRequiresDrinkingMethod } from '../types';
import type { SakeCategory } from '@/features/purchase/types';

const MotionButton = motion.create(Button);

interface DrinkingFormProps {
  onSubmitSuccess?: () => void;
}

export function DrinkingForm({ onSubmitSuccess }: DrinkingFormProps) {
  const {
    formData,
    errors,
    isSaving,
    handleChange,
    handleBlur,
    handleSubmit,
    successMessage,
    errorMessage,
    imageUpload,
  } = useDrinkingForm();

  const { handleOcrTrigger, isAnalyzing, ocrMessage, resetOcr } = useOcrTrigger(
    imageUpload,
    'drinking',
    (sakeName) => handleChange('sakeName', sakeName),
  );

  const isSubmitting = isSaving || imageUpload.isUploading || isAnalyzing;

  useEffect(() => {
    if (successMessage) {
      toast.success(successMessage);
      onSubmitSuccess?.();
    }
  }, [successMessage, onSubmitSuccess]);

  useEffect(() => {
    if (errorMessage) {
      toast.error(errorMessage);
    }
  }, [errorMessage]);

  const selectedDate = formData.drinkingDate
    ? parse(formData.drinkingDate, 'yyyy-MM-dd', new Date())
    : undefined;

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      handleChange('drinkingDate', format(date, 'yyyy-MM-dd'));
    }
  };

  const onFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSubmit();
  };

  const drinkingMethods = getDrinkingMethodsByCategory(formData.category as SakeCategory);
  const showDrinkingMethod = categoryRequiresDrinkingMethod(formData.category as SakeCategory);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      <form onSubmit={onFormSubmit} className="space-y-5" data-testid="drinking-form">
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

        {/* 飲んだ場所 */}
        <FormField label="飲んだ場所" error={errors.placeName} required>
          <Input
            data-testid="input-placeName"
            placeholder="例: 居酒屋 花鳥風月"
            value={formData.placeName}
            onChange={(e) => handleChange('placeName', e.target.value)}
            onBlur={() => handleBlur('placeName')}
            aria-invalid={!!errors.placeName}
          />
        </FormField>

        {/* 価格 */}
        <FormField label="価格" error={errors.price}>
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

        {/* 飲んだ日 */}
        <FormField label="飲んだ日" error={errors.drinkingDate} required>
          <DatePickerField
            value={selectedDate}
            onSelect={handleDateSelect}
            onBlur={() => handleBlur('drinkingDate')}
            testId="input-drinkingDate"
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

        {/* 飲み方（ビール・ワイン・その他は非表示） */}
        {showDrinkingMethod && (
          <FormField label="飲み方" error={errors.drinkingMethod} required>
            <Select
              value={formData.drinkingMethod}
              onValueChange={(val) => { if (val !== null) handleChange('drinkingMethod', val); }}
            >
              <SelectTrigger
                data-testid="input-drinkingMethod"
                className="w-full"
                onBlur={() => handleBlur('drinkingMethod')}
              >
                <SelectValue placeholder="飲み方を選択" />
              </SelectTrigger>
              <SelectContent>
                {drinkingMethods.map((method) => (
                  <SelectItem key={method} value={method}>
                    {method}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        )}

        {/* 評価 */}
        <FormField label="評価" error={errors.rating} required>
          <div data-testid="input-rating">
            <StarRating
              value={formData.rating}
              onChange={(val) => handleChange('rating', val)}
            />
          </div>
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
