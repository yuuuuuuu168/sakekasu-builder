// ラベル画像の形式と大きさの確かめ方。S3 から取り出した画像を、モデルへ送る前にここで見る。

/**
 * Bedrock が受け取れる画像の上限。
 *
 * base64 エンコード後の長さで判定されるため、元ファイルのサイズとは
 * 4/3 のずれがある。フロント側（`imageCompressor.ts`）はこの値から
 * 逆算した 3/4 を上限にしている。
 *
 * Claude API の上限も 1 枚 5MB で同じ。どちらへ送っても弾かれない大きさに揃えてあり、
 * Claude API から Bedrock へやり直しても画像の大きさで落ちることはない
 */
export const BEDROCK_IMAGE_BASE64_LIMIT = 5 * 1024 * 1024;

/**
 * base64 にして `BEDROCK_IMAGE_BASE64_LIMIT` に収まる原本の最大バイト数（3,932,160）。
 *
 * base64 の長さは `4 * ceil(n / 3)` なので、これを1バイトでも超えると上限を超える。
 * 原本の大きさでの判定は、base64 にしてからの判定と結果が完全に一致する。
 * フロント側（`imageCompressor.ts`）の `MAX_FILE_SIZE` も同じ値
 */
export const MAX_ORIGINAL_IMAGE_BYTES = (BEDROCK_IMAGE_BASE64_LIMIT / 4) * 3;

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/**
 * JPEG のマーカー番号の前に許す詰め物（FF）の数。
 *
 * 規格上は数に制限がないが、実際の JPEG で1バイトでも入っていること自体が稀。
 * 上限を置かないと、FF だけのファイルで中身の長さぶん読み進めることになる
 */
const MAX_JPEG_FILL_BYTES = 16;

/**
 * 形式ごとの先頭バイト（Issue #119）。
 *
 * WebP だけは離れた2区間を見る必要がある（`RIFF` + 4バイトの長さ + `WEBP`）ため、
 * 位置つきの区間の集まりとして持つ。同じ形式に複数の版がある GIF は、
 * 版ごとに別の項目として並べる（先に一致したものを採る）
 */
const IMAGE_SIGNATURES: {
  mediaType: ImageMediaType;
  segments: { offset: number; bytes: readonly number[] }[];
  /** 値が固定でないため区間では書けない条件（JPEG のマーカー番号） */
  extraCheck?: (bytes: Uint8Array) => boolean;
}[] = [
  {
    // JPEG は SOI（FF D8）+ 次のマーカーの開始（FF）。続くのはマーカー番号で、
    // 値は一つに定まらない。JFIF（E0）や Exif（E1）に絞ると、量子化テーブルから
    // 始まるもの（DB）や Adobe の APP14（EE）といった正当な JPEG を弾く。
    // 番号として妥当な範囲（C0 以上）かだけを見る。
    //
    // マーカー番号の前には詰め物の FF がいくつでも入れられる（ISO/IEC 10918-1
    // B.1.1.2）。FF 自体を番号として認めると `FF D8 FF FF 00` のように
    // 番号が妥当でない列まで通るので、詰め物は読み飛ばしてから番号を見る
    mediaType: 'image/jpeg',
    segments: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
    extraCheck: (bytes) => {
      let index = 3;
      const limit = index + MAX_JPEG_FILL_BYTES;
      while (bytes[index] === 0xff && index < limit) {
        index += 1;
      }
      // 末尾まで詰め物が続いた場合は undefined になり 0x00 として扱われる。
      // 上限まで詰め物が続いた場合は FF のまま止まる。どちらも番号に辿り着けて
      // いないので通さない（FF は C0 以上なので、明示的に外す）
      const marker = bytes[index] ?? 0x00;
      return marker !== 0xff && marker >= 0xc0;
    },
  },
  {
    mediaType: 'image/png',
    segments: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  },
  // GIF の版は "GIF87a" と "GIF89a" の2つだけ。`GIF8` までで切ると、
  // 続く2バイトが何であっても通ってしまう
  {
    mediaType: 'image/gif',
    segments: [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }], // "GIF87a"
  },
  {
    mediaType: 'image/gif',
    segments: [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }], // "GIF89a"
  },
  {
    mediaType: 'image/webp',
    segments: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF"
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // "WEBP"
    ],
  },
];

/**
 * バイト列の先頭から画像形式を判定する。判定できなければ null。
 *
 * 短すぎるファイルは範囲外の添字が undefined になり、どの形式とも一致しない
 */
export function detectImageMediaType(bytes: Uint8Array): ImageMediaType | null {
  const signature = IMAGE_SIGNATURES.find(
    ({ segments, extraCheck }) =>
      segments.every((segment) =>
        segment.bytes.every((byte, i) => bytes[segment.offset + i] === byte),
      ) && (extraCheck?.(bytes) ?? true),
  );
  return signature?.mediaType ?? null;
}

/**
 * S3 の ContentType から Bedrock に渡す mediaType を決める（Issue #119）。
 *
 * 認識できない値を `image/jpeg` に丸めない。presigned-url Lambda は
 * ContentType を検証しているが、S3 の presigned PUT は既定で UNSIGNED-PAYLOAD
 * なので本体バイトは署名の対象外で、そもそも署名を経ずに置かれたオブジェクトも
 * ありうる。丸めてしまうと、なぜ jpeg 扱いなのかが後から読み取れない
 */
export function resolveMediaType(contentType: string | undefined): ImageMediaType {
  const supported = IMAGE_SIGNATURES.map(({ mediaType }) => mediaType);
  const mediaType = supported.find((type) => type === contentType);

  if (!mediaType) {
    // 利用者が置いた値なので、改行でログを分断されないよう文字列として出す
    console.error(
      `[OCR] Unsupported image type: contentType=${JSON.stringify((contentType ?? '').slice(0, 100))}`,
    );
    throw new Error('Unsupported image type');
  }

  return mediaType;
}

/**
 * 中身が本当に画像かを、宣言された形式と突き合わせて確かめる（Issue #119）。
 *
 * ContentType はクライアントが送った文字列がそのまま S3 に残るだけなので、
 * これを信じると非画像のバイナリが `image/jpeg` として Bedrock に届く。
 * 先頭バイトを見れば、宣言とは独立に中身を判定できる。
 *
 * 宣言と中身が食い違う場合も落とす。この状態は Bedrock 側でも弾かれるが、
 * 「OCR に失敗しました」しか残らず、拡張子だけ書き換えたファイルなのか
 * 別の理由なのかが切り分けられない
 *
 * `Invalid image content` の文言も一括読み取り側が見ている。理由は
 * `assertImagesFitBedrockLimit()` の説明と同じ
 */
export function assertImagesAreRealImages(
  images: { bytes: Uint8Array; mediaType: ImageMediaType }[],
): void {
  images.forEach((image, index) => {
    const detected = detectImageMediaType(image.bytes);
    if (detected !== image.mediaType) {
      // キーには利用者の sub が入るのでログに出さない。位置だけ示す
      console.error(
        `[OCR] Invalid image content: index=${index} declared=${image.mediaType} detected=${detected ?? 'unknown'}`,
      );
      throw new Error('Invalid image content');
    }
  });
}

/**
 * Bedrock に渡せる大きさかを確かめる（Issue #115）。
 *
 * 見るのは大きさだけで、中身が画像かは見ない。そちらは
 * `assertImagesAreRealImages()` の担当（Issue #119）。
 *
 * 上限は base64 エンコード後の長さで判定されるため、元ファイルのサイズとは
 * 4/3 のずれがある。フロント側（`imageCompressor.ts`）も同じ制限から逆算した
 * 上限で圧縮しているが、そこを通らない経路（API を直接叩く、既存データの
 * 再解析）では効かないので、送る前にここでも見る。
 *
 * 超えていれば Bedrock を呼ばずに落とす。呼んでも ValidationException が
 * 返るだけで、失敗の理由がログから読み取りにくくなる
 *
 * **`Image too large for OCR` という文言は一括読み取り側が見ている。**
 * 画像を差し替えない限り必ず同じ失敗になる種類のエラーなので、フロントは
 * この文言で「二度と投げない」判断をする（`requestLabelSpecs.ts` の
 * `PERMANENT_FAILURE_MESSAGES`）。変えるときは向こうも直す。
 * 直し忘れても壊れはせず、一括読み取りが同じ画像を毎回投げ直す状態に戻る
 * （2026-08-24 に 150 回中 78 回を投げ直して OCR の30日 SLO が 54% まで落ちた）
 */
export function assertImagesFitBedrockLimit(
  images: { base64: string }[],
): void {
  images.forEach((image, index) => {
    if (image.base64.length > BEDROCK_IMAGE_BASE64_LIMIT) {
      // キーには利用者の sub が入るのでログに出さない。位置だけ示す
      console.error(
        `[OCR] image too large for Bedrock: index=${index} base64=${image.base64.length} limit=${BEDROCK_IMAGE_BASE64_LIMIT}`,
      );
      throw new Error('Image too large for OCR');
    }
  });
}

/**
 * S3 の応答ヘッダの大きさで、本体を読む前に上限を見る（sakekasu-builder#30）。
 *
 * 本体を最後まで読んで base64 にしてから `assertImagesFitBedrockLimit()` で
 * 落とすと、捨てると分かっているデータの転送と変換に時間とメモリを使う。
 * フロントの圧縮を通らない経路（API を直接叩く、既存データの再解析）で効く。
 *
 * `ContentLength` はメタデータで本体の長さの保証ではないので、
 * base64 にした後の `assertImagesFitBedrockLimit()` は最後の砦として残す。
 * 長さが返らないときは判定できないので通し、そちらに任せる。
 * 文言を揃えているのは、一括読み取り側が `Image too large for OCR` を見ているため
 */
export function assertStoredImageFitsBedrockLimit(
  index: number,
  contentLength: number | undefined,
): void {
  if (contentLength !== undefined && contentLength > MAX_ORIGINAL_IMAGE_BYTES) {
    // キーには利用者の sub が入るのでログに出さない。位置だけ示す
    console.error(
      `[OCR] image too large for Bedrock: index=${index} bytes=${contentLength} limit=${MAX_ORIGINAL_IMAGE_BYTES}`,
    );
    throw new Error('Image too large for OCR');
  }
}
