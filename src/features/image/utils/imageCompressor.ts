/**
 * 画像圧縮ユーティリティ
 * クライアント側で Canvas API を使って画像を正規化・圧縮する
 *
 * - 長辺が MAX_LONG_EDGE を超える画像は縮小して高品質 JPEG で再エンコード
 *   （OCR の精度・トークン効率と保存サイズの改善）
 * - それでも上限を超える場合は品質・解像度を段階的に下げる
 *
 * Validates: Requirements 2.4, 2.7, 2.8, 2.9, 2.10
 */

/** Bedrock が受け取れる画像の上限。base64 エンコード後の値で判定される */
const BEDROCK_IMAGE_BASE64_LIMIT = 5 * 1024 * 1024;

/**
 * 圧縮の目標サイズ（3.75MB）。
 *
 * OCR は画像を base64 にして Bedrock へ渡す。base64 は元のバイナリの 4/3 倍に
 * なるため、Bedrock の 5MB を満たすには元ファイルを 3/4 に収める必要がある。
 *
 * ここを 5MB にしていたせいで、3.75MB〜5MB の画像がこの検証を通ったのに
 * OCR だけ失敗していた（Issue #115）。上限は Bedrock 側の制限から逆算する
 */
const MAX_FILE_SIZE = Math.floor((BEDROCK_IMAGE_BASE64_LIMIT * 3) / 4);

/**
 * 画像として読めなかったファイルでも保存を許す上限（5MB）。
 *
 * Canvas で読めないファイルは縮小のしようがないため、そのまま通すか
 * 弾くかの二択になる。ここは「OCR に渡せるか」ではなく「保存を許すか」の
 * 判断なので、圧縮の目標（MAX_FILE_SIZE）とは別に持つ。
 *
 * 読めない画像は元から OCR に失敗する。それでも記録に写真を残せる方が
 * 利用者にとって損が小さいので、保存だけは通す。
 *
 * 一度ここを MAX_FILE_SIZE と共用してしまい、4MB 前後の画像が
 * 保存すらできなくなる退行を出した。2つの上限は目的が違う
 */
const MAX_UNREADABLE_UPLOAD_SIZE = 5 * 1024 * 1024;

/** 保存・OCR 用の長辺上限（px）。Claude vision が推奨する上限に合わせる */
const MAX_LONG_EDGE = 1568;

/** 長辺リサイズ時の JPEG 品質。OCR で文字が読める品質を保つ */
const NORMALIZE_QUALITY = 0.85;

/** 品質の開始値 */
const QUALITY_START = 0.9;

/** 品質の最低値 */
const QUALITY_MIN = 0.1;

/** 品質の減少ステップ */
const QUALITY_STEP = 0.1;

/** 解像度縮小スケール（段階的に縮小） */
const RESOLUTION_SCALES = [0.75, 0.5, 0.25];

/** サムネイルの最大辺（px）。一覧のサムネ枠は 80px だが Retina を考慮 */
const THUMBNAIL_MAX_EDGE = 320;

/** サムネイルの JPEG 品質 */
const THUMBNAIL_QUALITY = 0.7;

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
 * 指定の幅・高さで品質を段階的に下げて上限以下の Blob を探す
 *
 * @returns 上限以下の Blob、見つからなければ null
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

/** 長辺が MAX_LONG_EDGE に収まる幅・高さを計算する（元が小さい場合はそのまま） */
function scaleToLongEdge(
  width: number,
  height: number,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= MAX_LONG_EDGE) {
    return { width, height };
  }
  const scale = MAX_LONG_EDGE / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * 画像の正規化・圧縮
 *
 * 1. 長辺が 1568px を超える画像は 1568px に縮小し JPEG（品質 0.85）で再エンコード
 *    （上限超の画像を品質 0.1 まで落とすより OCR の文字が読める状態を保てる）
 * 2. 長辺 1568px 以下かつ上限以下の画像は再エンコードせずそのまま返す
 * 3. 上記でも上限を超える場合は品質を 0.9 → 0.1 まで段階的に下げ、
 *    さらに解像度を 75% → 50% → 25% に縮小して上限以下を探す
 * 4. それでも上限以下にならない場合はエラーをスロー
 *
 * @param file - 対象の画像ファイル
 * @returns 圧縮結果
 * @throws 圧縮に失敗した場合
 */
export async function compressImage(file: File): Promise<CompressionResult> {
  const originalSize = file.size;

  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch (error) {
    // Canvas で読めないファイルは縮小できないので、保存を許す上限で判定する。
    // 圧縮の目標（MAX_FILE_SIZE）で見ると、OCR には渡せないだけの画像まで
    // 保存できなくなる
    if (originalSize <= MAX_UNREADABLE_UPLOAD_SIZE) {
      return {
        file,
        originalSize,
        compressedSize: originalSize,
        wasCompressed: false,
      };
    }
    throw error instanceof Error
      ? error
      : new Error('画像の圧縮に失敗しました。もっと小さい画像を選択してください');
  }

  const { width, height } = scaleToLongEdge(img.naturalWidth, img.naturalHeight);
  const needsResize =
    width !== img.naturalWidth || height !== img.naturalHeight;

  // 長辺が上限以下かつサイズも上限以下なら再エンコードしない
  if (!needsResize && originalSize <= MAX_FILE_SIZE) {
    return {
      file,
      originalSize,
      compressedSize: originalSize,
      wasCompressed: false,
    };
  }

  try {
    // 長辺 1568px + 高品質 JPEG で再エンコード
    if (needsResize) {
      const blob = await canvasToBlob(img, width, height, NORMALIZE_QUALITY);
      if (blob.size <= MAX_FILE_SIZE) {
        // 再エンコードで元よりサイズが増えた場合は元ファイルを使う
        // （上限超だった場合は増えることはないので必ず縮小版が使われる）
        if (blob.size >= originalSize) {
          return {
            file,
            originalSize,
            compressedSize: originalSize,
            wasCompressed: false,
          };
        }
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

    // リサイズ後の解像度で品質を段階的に下げて試行
    const blobAtBase = await tryCompressAtResolution(img, width, height);
    if (blobAtBase) {
      const compressedFile = new File([blobAtBase], file.name, {
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
      const scaledWidth = Math.max(1, Math.round(width * scale));
      const scaledHeight = Math.max(1, Math.round(height * scale));

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

    // すべての試行で上限以下にできなかった場合
    throw new Error(
      '画像の圧縮に失敗しました。もっと小さい画像を選択してください',
    );
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(
      '画像の圧縮に失敗しました。もっと小さい画像を選択してください',
    );
  }
}

/**
 * 一覧表示用のサムネイルを生成する
 *
 * 一覧では 80px 四方の枠にしか使わないのに原画（最大 3.75MB）を
 * ダウンロードしていたため、長辺 320px・JPEG 品質 0.7 の
 * 小さな画像を別途作って表示に使う。
 *
 * @param file - 元の画像ファイル
 * @param fileName - 生成するサムネイルのファイル名
 * @returns サムネイルの File（JPEG）
 * @throws 画像の読み込み・変換に失敗した場合
 */
export async function createThumbnail(
  file: File,
  fileName: string,
): Promise<File> {
  const img = await loadImage(file);
  const { naturalWidth: width, naturalHeight: height } = img;

  // 長辺を THUMBNAIL_MAX_EDGE に収める（元が小さい場合は拡大しない）
  const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(width, height));
  const blob = await canvasToBlob(
    img,
    Math.max(1, Math.round(width * scale)),
    Math.max(1, Math.round(height * scale)),
    THUMBNAIL_QUALITY,
  );

  return new File([blob], fileName, { type: 'image/jpeg' });
}
