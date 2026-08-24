import { useEffect, useRef } from 'react';
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
import { useImageUrls } from '@/features/image/hooks/useImageUrls';
import { SakeSpecFields } from '@/features/specs/components/SakeSpecFields';
import type { SakeSpecFormData } from '@/features/specs/types';
import { getDrinkingMethodsByCategory, categoryRequiresDrinkingMethod } from '../types';
import type { DrinkingFormData, StockDrinkDraft } from '../types';
import type { SakeCategory } from '@/features/purchase/types';

const MotionButton = motion.create(Button);

/** 毎レンダリングで新しい配列を渡すと URL の再取得が走るため、空配列は使い回す */
const EMPTY_KEYS: string[] = [];

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

  // 編集時は「今ある写真の続きに足す」と分かるよう、登録済みの画像も並べる
  const { imageUrls: existingImageUrls } = useImageUrls(existingImageKeys ?? EMPTY_KEYS);

  // ユーザーが手動でカテゴリを選択したか（自動OCRで選択を上書きしないための追跡）
  const categoryTouchedRef = useRef(false);

  const { handleOcrTrigger, isAnalyzing, ocrMessage, resetOcr, hasAnalyzed } = useOcrTrigger(
    imageUpload,
    'drinking',
    (info, { isAuto }) => {
      // 自動実行では入力済みの銘柄名・選択済みのカテゴリを上書きしない（手動の再読み取りは上書きする）
      if (!isAuto || formData.sakeName.trim() === '') {
        handleChange('sakeName', info.sakeName);
      }
      if (info.category && (!isAuto || !categoryTouchedRef.current)) {
        handleChange('category', info.category);
      }
      // 産地・度数を含む詳細スペックはそれぞれの入力欄へ入れる（Issue #87・#88）。
      // 自動実行では入力済みの項目を残す
      specs.applyOcrResult(info.specs, info.lowConfidenceSpecFields, { overwrite: !isAuto });
    },
  );

  // 保存だけでなく在庫ステータス更新やフォームのリセットが終わるまで押せないようにする
  const isSubmitting = isSubmittingForm || imageUpload.isUploading || isAnalyzing;

  useEffect(() => {
    if (successMessage) {
      toast.success(successMessage);
      // フォームリセットに合わせてOCRの解析済み管理も初期化する（同じ画像の再登録で自動OCRが動くように）
      categoryTouchedRef.current = false;
      resetOcr();
      onSubmitSuccess?.();
    }
  }, [successMessage, onSubmitSuccess, resetOcr]);

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
        <FormField label={isEditMode ? '画像を追加（任意）' : '画像（任意）'}>
          <ImageUploadArea
            imageFile={imageUpload.imageFile}
            imageFiles={imageUpload.imageFiles}
            existingImageUrls={existingImageUrls}
            onImageChange={(file) => {
              if (file) {
                imageUpload.handleImageSelect(file);
              } else {
                imageUpload.clearImage();
                resetOcr();
              }
            }}
            onImageRemove={imageUpload.removeImage}
            isCompressing={imageUpload.isCompressing}
            isUploading={imageUpload.isUploading}
            error={imageUpload.error}
            warning={imageUpload.warning}
            disabled={isSubmitting}
            isOcrAnalyzing={isAnalyzing}
            onOcrTrigger={handleOcrTrigger}
            ocrMessage={ocrMessage}
            hasOcrRun={hasAnalyzed}
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
            onChange={(val) => {
              if (val !== null) {
                categoryTouchedRef.current = true;
                handleChange('category', val);
              }
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
        <FormField label="メモ">
          <Textarea
            data-testid="input-memo"
            placeholder="味の感想やメモなど（任意）"
            value={formData.memo}
            onChange={(e) => handleChange('memo', e.target.value)}
            rows={3}
          />
        </FormField>

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
              {imageUpload.isUploading ? '画像アップロード中...' : isEditMode ? '更新中...' : '登録中...'}
            </>
          ) : isEditMode ? (
            '🍶 更新する'
          ) : (
            '🍶 登録する'
          )}
        </MotionButton>
      </form>
    </motion.div>
  );
}
