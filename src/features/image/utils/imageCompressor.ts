/**
 * 画像圧縮ユーティリティ
 * 5MB を超える画像をクライアント側で Canvas API を使って自動圧縮する
 *
 * Validates: Requirements 2.4, 2.7, 2.8, 2.9, 2.10
 */

/** 最大ファイルサイズ: 5MB */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** 品質の開始値 */
const QUALITY_START = 0.9;

/** 品質の最低値 */
const QUALITY_MIN = 0.1;

/** 品質の減少ステップ */
const QUALITY_STEP = 0.1;

/** 解像度縮小スケール（段階的に縮小） */
const RESOLUTION_SCALES = [0.75, 0.5, 0.25];

export interface CompressionResult {
  file: File;
  originalSize: number;
  compressedSize: number;
  wasCompressed: boolean;
}

/**
 * File を HTMLImageElement として読み込む
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('画像の読み込みに失敗しました'));
    };

    img.src = url;
  });
}

/**
 * Canvas に画像を描画し、指定の品質で JPEG Blob に変換する
 */
function canvasToBlob(
  img: HTMLImageElement,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Canvas コンテキストの取得に失敗しました'));
      return;
    }

    ctx.drawImage(img, 0, 0, width, height);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas から Blob への変換に失敗しました'));
        }
      },
      'image/jpeg',
      quality,
    );
  });
}

/**
 * 指定の幅・高さで品質を段階的に下げて 5MB 以下の Blob を探す
 *
 * @returns 5MB 以下の Blob、見つからなければ null
 */
async function tryCompressAtResolution(
  img: HTMLImageElement,
  width: number,
  height: number,
): Promise<Blob | null> {
  for (
    let quality = QUALITY_START;
    quality >= QUALITY_MIN - 0.001;
    quality -= QUALITY_STEP
  ) {
    const q = Math.round(quality * 10) / 10; // 浮動小数点誤差を回避
    const blob = await canvasToBlob(img, width, height, q);
    if (blob.size <= MAX_FILE_SIZE) {
      return blob;
    }
  }
  return null;
}

/**
 * 画像圧縮（5MB 超の場合のみ）
 *
 * 1. ファイルサイズが 5MB 以下ならそのまま返す
 * 2. Canvas API で品質を 0.9 → 0.1 まで段階的に下げて圧縮
 * 3. 品質最低でも 5MB 以下にならない場合は解像度を 75% → 50% → 25% に縮小
 * 4. 圧縮後は JPEG 形式で出力
 * 5. それでも 5MB 以下にならない場合はエラーをスロー
 *
 * @param file - 圧縮対象の画像ファイル
 * @returns 圧縮結果
 * @throws 圧縮に失敗した場合
 */
export async function compressImage(file: File): Promise<CompressionResult> {
  const originalSize = file.size;

  // 5MB 以下はそのまま返す
  if (originalSize <= MAX_FILE_SIZE) {
    return {
      file,
      originalSize,
      compressedSize: originalSize,
      wasCompressed: false,
    };
  }

  try {
    const img = await loadImage(file);
    const originalWidth = img.naturalWidth;
    const originalHeight = img.naturalHeight;

    // 元の解像度で品質を段階的に下げて試行
    const blobAtOriginal = await tryCompressAtResolution(
      img,
      originalWidth,
      originalHeight,
    );
    if (blobAtOriginal) {
      const compressedFile = new File([blobAtOriginal], file.name, {
        type: 'image/jpeg',
      });
      return {
        file: compressedFile,
        originalSize,
        compressedSize: compressedFile.size,
        wasCompressed: true,
      };
    }

    // 解像度を段階的に縮小して試行
    for (const scale of RESOLUTION_SCALES) {
      const scaledWidth = Math.round(originalWidth * scale);
      const scaledHeight = Math.round(originalHeight * scale);

      const blob = await tryCompressAtResolution(img, scaledWidth, scaledHeight);
      if (blob) {
        const compressedFile = new File([blob], file.name, {
          type: 'image/jpeg',
        });
        return {
          file: compressedFile,
          originalSize,
          compressedSize: compressedFile.size,
          wasCompressed: true,
        };
      }
    }

    // すべての試行で 5MB 以下にできなかった場合
    throw new Error(
      '画像の圧縮に失敗しました。5MB以下の画像を選択してください',
    );
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(
      '画像の圧縮に失敗しました。5MB以下の画像を選択してください',
    );
  }
}
