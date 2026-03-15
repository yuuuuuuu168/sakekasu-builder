import { useState, useCallback } from 'react';
import { generateClient } from 'aws-amplify/api';
import { generateUploadUrl } from '@/graphql/mutations';
import { validateImageFile } from '../utils/imageValidator';
import { compressImage } from '../utils/imageCompressor';

const client = generateClient();

/** 圧縮が必要なファイルサイズ閾値: 5MB */
const COMPRESSION_THRESHOLD = 5 * 1024 * 1024;

/** 最大画像数 */
const MAX_IMAGES = 5;

export interface UseImageUploadReturn {
  /** 選択された画像ファイル（後方互換: 最初の1枚） */
  imageFile: File | null;
  /** 選択された画像ファイル一覧 */
  imageFiles: File[];
  /** 画像ファイル設定（後方互換） */
  setImageFile: (file: File | null) => void;
  /** 圧縮中フラグ */
  isCompressing: boolean;
  /** アップロード中フラグ */
  isUploading: boolean;
  /** エラーメッセージ */
  error: string | null;
  /** S3 上の画像キー（事前アップロード後に設定、後方互換: 最初の1枚） */
  imageKey: string | null;
  /** S3 上の画像キー一覧 */
  imageKeys: string[];
  /** 画像ファイル選択ハンドラ（バリデーション + 圧縮）: 追加モード */
  handleImageSelect: (file: File) => Promise<void>;
  /** 特定の画像を削除 */
  removeImage: (index: number) => void;
  /** 画像アップロード実行（全ファイル） */
  uploadImage: (recordType: string, recordId: string) => Promise<string | null>;
  /** 複数画像アップロード実行 */
  uploadImages: (recordType: string, recordId: string) => Promise<string[]>;
  /** OCR 用の事前アップロード（最初の1枚のみ） */
  preUploadImage: (recordType: string) => Promise<string | null>;
  /** 画像クリア */
  clearImage: () => void;
}

export function useImageUpload(): UseImageUploadReturn {
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageKeys, setImageKeys] = useState<string[]>([]);

  // 後方互換用
  const imageFile = imageFiles[0] ?? null;
  const imageKey = imageKeys[0] ?? null;

  const setImageFile = useCallback((file: File | null) => {
    if (file) {
      setImageFiles([file]);
    } else {
      setImageFiles([]);
    }
  }, []);

  const handleImageSelect = useCallback(async (file: File) => {
    // 最大枚数チェック
    if (imageFiles.length >= MAX_IMAGES) {
      setError(`画像は最大${MAX_IMAGES}枚まで添付できます`);
      return;
    }

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
        setImageFiles((prev) => [...prev, result.file]);
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
      setImageFiles((prev) => [...prev, file]);
    }
  }, [imageFiles.length]);

  const removeImage = useCallback((index: number) => {
    setImageFiles((prev) => prev.filter((_, i) => i !== index));
    setImageKeys((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /** 単一ファイルのアップロード処理 */
  const uploadSingleFile = async (
    file: File,
    recordType: string,
    recordId: string,
  ): Promise<string | null> => {
    const result = await client.graphql({
      query: generateUploadUrl,
      variables: {
        recordType,
        recordId,
        contentType: file.type,
        fileName: file.name,
      },
    });

    if ('errors' in result && result.errors && result.errors.length > 0) {
      console.error('generateUploadUrl errors:', result.errors);
      return null;
    }

    const { uploadUrl, key } = (result as { data: { generateUploadUrl: { uploadUrl: string; key: string } } }).data.generateUploadUrl;

    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });

    if (!uploadResponse.ok) {
      console.error('S3 upload failed:', uploadResponse.status);
      return null;
    }

    return key;
  };

  const uploadImages = useCallback(
    async (recordType: string, recordId: string): Promise<string[]> => {
      if (imageFiles.length === 0) return [];

      // 事前アップロード済みのキーがある場合はそれを返す
      if (imageKeys.length > 0) return imageKeys;

      setIsUploading(true);
      try {
        const keys: string[] = [];
        for (const file of imageFiles) {
          const key = await uploadSingleFile(file, recordType, recordId);
          if (key === null) {
            setError('画像のアップロードに失敗しました。もう一度お試しください');
            return [];
          }
          keys.push(key);
        }
        setImageKeys(keys);
        return keys;
      } catch (err) {
        console.error('Image upload failed:', err);
        setError('画像のアップロードに失敗しました。もう一度お試しください');
        return [];
      } finally {
        setIsUploading(false);
      }
    },
    [imageFiles, imageKeys],
  );

  // 後方互換: 最初の1枚のキーを返す
  const uploadImage = useCallback(
    async (recordType: string, recordId: string): Promise<string | null> => {
      const keys = await uploadImages(recordType, recordId);
      return keys[0] ?? null;
    },
    [uploadImages],
  );

  const preUploadImage = useCallback(
    async (recordType: string): Promise<string | null> => {
      const firstFile = imageFiles[0];
      if (!firstFile) return null;

      if (imageKeys[0]) return imageKeys[0];

      setIsUploading(true);
      try {
        const tempRecordId = crypto.randomUUID();
        const key = await uploadSingleFile(firstFile, recordType, tempRecordId);
        if (key === null) {
          setError('画像のアップロードに失敗しました。もう一度お試しください');
          return null;
        }
        setImageKeys((prev) => {
          const next = [...prev];
          next[0] = key;
          return next;
        });
        return key;
      } catch (err) {
        console.error('Image pre-upload failed:', err);
        setError('画像のアップロードに失敗しました。もう一度お試しください');
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [imageFiles, imageKeys],
  );

  const clearImage = useCallback(() => {
    setImageFiles([]);
    setError(null);
    setImageKeys([]);
  }, []);

  return {
    imageFile,
    imageFiles,
    setImageFile,
    isCompressing,
    isUploading,
    error,
    imageKey,
    imageKeys,
    handleImageSelect,
    removeImage,
    uploadImage,
    uploadImages,
    preUploadImage,
    clearImage,
  };
}
