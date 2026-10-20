import { FormField } from '@/components/form/FormField';
import { ImageUploadArea } from './ImageUploadArea';
import { useImageUrls } from '../hooks/useImageUrls';
import type { UseImageUploadReturn } from '../hooks/useImageUpload';
import type { UseRecordOcrReturn } from '../hooks/useRecordOcr';

/** 毎レンダリングで新しい配列を渡すと URL の再取得が走るため、空配列は使い回す */
const EMPTY_KEYS: string[] = [];

interface RecordImageFieldProps {
  imageUpload: UseImageUploadReturn;
  ocr: UseRecordOcrReturn;
  isEditMode: boolean;
  /** 編集対象が既に持っている画像キー一覧 */
  existingImageKeys?: string[];
  disabled: boolean;
}

/** 購入・飲酒フォームの画像欄。読み取り（OCR）のボタンと結果の表示も含む */
export function RecordImageField({
  imageUpload,
  ocr,
  isEditMode,
  existingImageKeys,
  disabled,
}: RecordImageFieldProps) {
  // 編集時は「今ある写真の続きに足す」と分かるよう、登録済みの画像も並べる
  const { imageUrls: existingImageUrls } = useImageUrls(existingImageKeys ?? EMPTY_KEYS);

  return (
    <FormField label={isEditMode ? '画像を追加（任意）' : '画像（任意）'}>
      <ImageUploadArea
        imageFiles={imageUpload.imageFiles}
        existingImageUrls={existingImageUrls}
        onImageChange={imageUpload.handleImageSelect}
        onImageRemove={imageUpload.removeImage}
        isCompressing={imageUpload.isCompressing}
        isUploading={imageUpload.isUploading}
        error={imageUpload.error}
        warning={imageUpload.warning}
        disabled={disabled}
        isOcrAnalyzing={ocr.isAnalyzing}
        onOcrTrigger={ocr.handleOcrTrigger}
        ocrMessage={ocr.ocrMessage}
        hasOcrRun={ocr.hasAnalyzed}
      />
    </FormField>
  );
}
