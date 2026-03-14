import { useState, useCallback } from 'react';
import { generateClient } from 'aws-amplify/api';
import { generateUploadUrl } from '@/graphql/mutations';
import { validateImageFile } from '../utils/imageValidator';
import { compressImage } from '../utils/imageCompressor';

const client = generateClient();

/** 圧縮が必要なファイルサイズ閾値: 5MB */
const COMPRESSION_THRESHOLD = 5 * 1024 * 1024;

export interface UseImageUploadReturn {
  /** 選択された画像ファイル */
  imageFile: File | null;
  /** 画像ファイル設定 */
  setImageFile: (file: File | null) => void;
  /** 圧縮中フラグ */
  isCompressing: boolean;
  /** アップロード中フラグ */
  isUploading: boolean;
  /** エラーメッセージ */
  error: string | null;
  /** S3 上の画像キー（事前アップロード後に設定） */
  imageKey: string | null;
  /** 画像ファイル選択ハンドラ（バリデーション + 圧縮） */
  handleImageSelect: (file: File) => Promise<void>;
  /** 画像アップロード実行（Presigned URL 取得 → S3 PUT） */
  uploadImage: (recordType: string, recordId: string) => Promise<string | null>;
  /** OCR 用の事前アップロード（仮の recordId で S3 にアップロードし imageKey を返す） */
  preUploadImage: (recordType: string) => Promise<string | null>;
  /** 画像クリア */
  clearImage: () => void;
}

/**
 * 画像アップロードのロジックを管理するカスタムフック
 *
 * - handleImageSelect: バリデーション → 圧縮 → プレビュー設定
 * - uploadImage: generateUploadUrl ミューテーション → S3 PUT → imageKey 返却
 * - clearImage: 状態リセット
 *
 * Validates: Requirements 1.6, 2.4, 2.5, 2.6, 3.1, 3.2, 3.7, 3.8, 3.9
 */
export function useImageUpload(): UseImageUploadReturn {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageKey, setImageKey] = useState<string | null>(null);

  const handleImageSelect = useCallback(async (file: File) => {
    // バリデーション
    const validation = validateImageFile(file);
    if (!validation.valid) {
      setError(validation.error);
      return;
    }

    setError(null);

    // 5MB 超の場合は圧縮
    if (file.size > COMPRESSION_THRESHOLD) {
      setIsCompressing(true);
      try {
        const result = await compressImage(file);
        setImageFile(result.file);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : '画像の圧縮に失敗しました。5MB以下の画像を選択してください';
        setError(message);
      } finally {
        setIsCompressing(false);
      }
    } else {
      setImageFile(file);
    }
  }, []);

  const uploadImage = useCallback(
    async (recordType: string, recordId: string): Promise<string | null> => {
      if (!imageFile) {
        return null;
      }

      // 事前アップロード済みの場合はそのキーを返す
      if (imageKey) {
        return imageKey;
      }

      setIsUploading(true);
      try {
        // Presigned URL を取得
        const result = await client.graphql({
          query: generateUploadUrl,
          variables: {
            recordType,
            recordId,
            contentType: imageFile.type,
            fileName: imageFile.name,
          },
        });

        if ('errors' in result && result.errors && result.errors.length > 0) {
          console.error('generateUploadUrl errors:', result.errors);
          setError('画像のアップロードに失敗しました。もう一度お試しください');
          return null;
        }

        const { uploadUrl, key } = (result as { data: { generateUploadUrl: { uploadUrl: string; key: string } } }).data.generateUploadUrl;

        // S3 に PUT
        const uploadResponse = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': imageFile.type,
          },
          body: imageFile,
        });

        if (!uploadResponse.ok) {
          console.error('S3 upload failed:', uploadResponse.status);
          setError('画像のアップロードに失敗しました。もう一度お試しください');
          return null;
        }

        return key;
      } catch (err) {
        console.error('Image upload failed:', err);
        setError('画像のアップロードに失敗しました。もう一度お試しください');
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [imageFile, imageKey],
  );

  const preUploadImage = useCallback(
    async (recordType: string): Promise<string | null> => {
      if (!imageFile) {
        return null;
      }

      // 既に事前アップロード済みの場合はそのキーを返す
      if (imageKey) {
        return imageKey;
      }

      setIsUploading(true);
      try {
        const tempRecordId = crypto.randomUUID();

        // Presigned URL を取得
        const result = await client.graphql({
          query: generateUploadUrl,
          variables: {
            recordType,
            recordId: tempRecordId,
            contentType: imageFile.type,
            fileName: imageFile.name,
          },
        });

        if ('errors' in result && result.errors && result.errors.length > 0) {
          console.error('generateUploadUrl errors:', result.errors);
          setError('画像のアップロードに失敗しました。もう一度お試しください');
          return null;
        }

        const { uploadUrl, key } = (
          result as {
            data: {
              generateUploadUrl: { uploadUrl: string; key: string };
            };
          }
        ).data.generateUploadUrl;

        // S3 に PUT
        const uploadResponse = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': imageFile.type,
          },
          body: imageFile,
        });

        if (!uploadResponse.ok) {
          console.error('S3 pre-upload failed:', uploadResponse.status);
          setError('画像のアップロードに失敗しました。もう一度お試しください');
          return null;
        }

        setImageKey(key);
        return key;
      } catch (err) {
        console.error('Image pre-upload failed:', err);
        setError('画像のアップロードに失敗しました。もう一度お試しください');
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [imageFile, imageKey],
  );

  const clearImage = useCallback(() => {
    setImageFile(null);
    setError(null);
    setImageKey(null);
  }, []);

  return {
    imageFile,
    setImageFile,
    isCompressing,
    isUploading,
    error,
    imageKey,
    handleImageSelect,
    uploadImage,
    preUploadImage,
    clearImage,
  };
}
