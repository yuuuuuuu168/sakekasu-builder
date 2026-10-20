import { useEffect } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { FormField } from '@/components/form/FormField';
import { IsoDateField } from '@/components/form/IsoDateField';
import { CategorySelect } from '@/components/form/CategorySelect';
import { PriceInput } from '@/components/form/PriceInput';
import { MemoField } from '@/components/form/MemoField';
import { SubmitButton } from '@/components/form/SubmitButton';

import { useDrinkingForm } from '../hooks/useDrinkingForm';
import { StarRating } from './StarRating';
import { RecordImageField } from '@/features/image/components/RecordImageField';
import { useRecordOcr } from '@/features/image/hooks/useRecordOcr';
import { SakeSpecFields } from '@/features/specs/components/SakeSpecFields';
import type { SakeSpecFormData } from '@/features/specs/types';
import { getDrinkingMethodsByCategory, categoryRequiresDrinkingMethod } from '../types';
import type { DrinkingFormData, StockDrinkDraft } from '../types';
import type { SakeCategory } from '@/types/sake';

interface DrinkingFormProps {
  onSubmitSuccess?: () => void;
  /** 編集対象の記録ID。指定時は編集モード（更新）となる */
  recordId?: string;
  /** 編集モードでのフォーム初期値 */
  initialData?: DrinkingFormData;
  /** 編集モードでの詳細スペック初期値 */
  initialSpecs?: SakeSpecFormData;
  /** 在庫（購入記録）から登録する場合の紐づけ情報 */
  stockDraft?: StockDrinkDraft | null;
  /** 在庫からの登録完了・紐づけ解除の通知 */
  onStockDraftClear?: () => void;
  /** 編集対象が既に持っている代表画像キー */
  existingImageKey?: string | null;
  /** 編集対象が既に持っている画像キー一覧 */
  existingImageKeys?: string[];
}

export function DrinkingForm({
  onSubmitSuccess,
  recordId,
  initialData,
  initialSpecs,
  stockDraft,
  onStockDraftClear,
  existingImageKey,
  existingImageKeys,
}: DrinkingFormProps) {
  const isEditMode = recordId !== undefined;
  const {
    formData,
    errors,
    isSubmitting: isSubmittingForm,
    handleChange,
    handleBlur,
    handleSubmit,
    successMessage,
    errorMessage,
    imageUpload,
    specs,
  } = useDrinkingForm({
    recordId,
    initialData,
    initialSpecs,
    stockDraft,
    onStockDrinkSaved: onStockDraftClear,
    existingImageKey,
    existingImageKeys,
  });

  const ocr = useRecordOcr({
    imageUpload,
    recordType: 'drinking',
    sakeName: formData.sakeName,
    setSakeName: (value) => handleChange('sakeName', value),
    setCategory: (value) => handleChange('category', value),
    specs,
  });
  const { resetAfterSubmit } = ocr;

  // 保存だけでなく在庫ステータス更新やフォームのリセットが終わるまで押せないようにする
  const isSubmitting = isSubmittingForm || imageUpload.isUploading || ocr.isAnalyzing;

  useEffect(() => {
    if (successMessage) {
      toast.success(successMessage);
      resetAfterSubmit();
      onSubmitSuccess?.();
    }
  }, [successMessage, onSubmitSuccess, resetAfterSubmit]);

  useEffect(() => {
    if (errorMessage) {
      toast.error(errorMessage);
    }
  }, [errorMessage]);

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
        {/* 在庫との紐づけ表示 */}
        {stockDraft && (
          <div
            className="flex items-center justify-between gap-2 rounded-lg border border-sake-gold/40 bg-sake-gold/10 px-3 py-2"
            data-testid="stock-link-banner"
          >
            <span className="min-w-0 text-sm text-gray-700 dark:text-gray-200">
              🍶 在庫の「
              <span className="font-bold">{stockDraft.sakeName}</span>
              」として登録します
            </span>
            <button
              type="button"
              onClick={onStockDraftClear}
              className="shrink-0 rounded px-2 py-1 text-xs text-gray-500 underline transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              data-testid="stock-link-clear"
            >
              紐づけを解除
            </button>
          </div>
        )}

        {/* 画像添付（編集時は登録済みの写真の続きに追加する） */}
        <RecordImageField
          imageUpload={imageUpload}
          ocr={ocr}
          isEditMode={isEditMode}
          existingImageKeys={existingImageKeys}
          disabled={isSubmitting}
        />

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
          <PriceInput
            value={formData.price}
            onChange={(value) => handleChange('price', value)}
            onBlur={() => handleBlur('price')}
            invalid={!!errors.price}
          />
        </FormField>

        {/* 飲んだ日 */}
        <FormField label="飲んだ日" error={errors.drinkingDate} required>
          <IsoDateField
            value={formData.drinkingDate}
            onChange={(value) => handleChange('drinkingDate', value)}
            onBlur={() => handleBlur('drinkingDate')}
            testId="input-drinkingDate"
          />
        </FormField>

        {/* カテゴリ */}
        <FormField label="カテゴリ" error={errors.category} required>
          <CategorySelect
            value={formData.category}
            onChange={(val) => {
              if (val !== null) ocr.selectCategory(val);
            }}
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
        <MemoField value={formData.memo} onChange={(value) => handleChange('memo', value)} />

        {/* 詳細スペック（任意）。既定は折りたたみ、入力済みや読み取り結果があれば開く */}
        <SakeSpecFields
          specs={specs.specs}
          errors={specs.specErrors}
          category={formData.category}
          onChange={specs.handleSpecChange}
          onBlur={specs.handleSpecBlur}
          disabled={isSubmitting}
          lowConfidenceFields={specs.lowConfidenceSpecFields}
        />

        {/* 登録ボタン */}
        <SubmitButton
          isSubmitting={isSubmitting}
          isEditMode={isEditMode}
          busyLabel={imageUpload.isUploading ? '画像アップロード中...' : null}
        />
      </form>
    </motion.div>
  );
}
