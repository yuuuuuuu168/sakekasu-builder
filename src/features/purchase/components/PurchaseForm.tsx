import { useEffect } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

import { Input } from '@/components/ui/input';

import { FormField } from '@/components/form/FormField';
import { IsoDateField } from '@/components/form/IsoDateField';
import { CategorySelect } from '@/components/form/CategorySelect';
import { PriceInput } from '@/components/form/PriceInput';
import { MemoField } from '@/components/form/MemoField';
import { SubmitButton } from '@/components/form/SubmitButton';

import { usePurchaseForm } from '@/features/purchase/hooks/usePurchaseForm';
import { usePastRatingHint } from '@/features/purchase/hooks/usePastRatingHint';
import { PastRatingHint } from '@/features/purchase/components/PastRatingHint';
import type { PurchaseFormData } from '@/features/purchase/types';
import type { BottleStock } from '@/features/records/lib/bottleCount';
import { RecordImageField } from '@/features/image/components/RecordImageField';
import { useRecordOcr } from '@/features/image/hooks/useRecordOcr';
import { SakeSpecFields } from '@/features/specs/components/SakeSpecFields';
import type { SakeSpecFormData } from '@/features/specs/types';

interface PurchaseFormProps {
  onSubmitSuccess?: () => void;
  /** 編集対象の記録ID。指定時は編集モード（更新）となる */
  recordId?: string;
  /** 編集モードでのフォーム初期値 */
  initialData?: PurchaseFormData;
  /** 編集モードでの詳細スペック初期値 */
  initialSpecs?: SakeSpecFormData;
  /** 編集対象が既に持っている代表画像キー */
  existingImageKey?: string | null;
  /** 編集対象が既に持っている画像キー一覧 */
  existingImageKeys?: string[];
  /** 編集対象の本数と残本数（本数を書き換えたときの残本数計算に使う） */
  existingBottles?: BottleStock;
}

export function PurchaseForm({
  onSubmitSuccess,
  recordId,
  initialData,
  initialSpecs,
  existingImageKey,
  existingImageKeys,
  existingBottles,
}: PurchaseFormProps) {
  const isEditMode = recordId !== undefined;
  const {
    formData,
    errors,
    isSaving,
    isSubmitting: isSubmittingForm,
    isGeneratingNote,
    submitResult,
    handleChange,
    handleBlur,
    handleSubmit,
    imageUpload,
    specs,
  } = usePurchaseForm({
    recordId,
    initialData,
    initialSpecs,
    existingImageKey,
    existingImageKeys,
    existingBottles,
  });

  const ocr = useRecordOcr({
    imageUpload,
    recordType: 'purchase',
    sakeName: formData.sakeName,
    setSakeName: (value) => handleChange('sakeName', value),
    setCategory: (value) => handleChange('category', value),
    specs,
  });
  const { resetAfterSubmit } = ocr;

  const isSubmitting =
    isSubmittingForm || isSaving || imageUpload.isUploading || ocr.isAnalyzing || isGeneratingNote;

  // リピート判定リマインド: 銘柄名にマッチする過去の飲酒評価を表示
  const { summaries: pastRatings } = usePastRatingHint(formData.sakeName);

  useEffect(() => {
    if (!submitResult) return;
    if (submitResult.success) {
      toast.success(isEditMode ? '更新が完了しました' : '登録が完了しました');
      resetAfterSubmit();
      onSubmitSuccess?.();
    } else {
      toast.error(
        submitResult.error ??
          (isEditMode
            ? '更新に失敗しました。もう一度お試しください'
            : '登録に失敗しました。もう一度お試しください'),
      );
    }
  }, [submitResult, onSubmitSuccess, isEditMode, resetAfterSubmit]);

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
        <PastRatingHint summaries={pastRatings} />
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
        <PriceInput
          value={formData.price}
          onChange={(value) => handleChange('price', value)}
          onBlur={() => handleBlur('price')}
          invalid={!!errors.price}
        />
      </FormField>

      {/* 本数 */}
      <FormField label="本数" error={errors.quantity} required>
        <div className="relative">
          <Input
            data-testid="input-quantity"
            type="number"
            min="1"
            step="1"
            placeholder="1"
            className="pr-10"
            value={formData.quantity}
            onChange={(e) => handleChange('quantity', e.target.value)}
            onBlur={() => handleBlur('quantity')}
            aria-invalid={!!errors.quantity}
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            本
          </span>
        </div>
      </FormField>

      {/* 購入日 */}
      <FormField label="購入日" error={errors.purchaseDate} required>
        <IsoDateField
          value={formData.purchaseDate}
          onChange={(value) => handleChange('purchaseDate', value)}
          onBlur={() => handleBlur('purchaseDate')}
          testId="input-purchaseDate"
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
        busyLabel={
          imageUpload.isUploading
            ? '画像アップロード中...'
            : isGeneratingNote
              ? 'テイスティングノート生成中...'
              : null
        }
      />
    </form>
    </motion.div>
  );
}
