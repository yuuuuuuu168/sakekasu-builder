import { useState, useCallback, useMemo, useRef } from 'react';
import { generateClient } from 'aws-amplify/api';
import { generateUploadUrl } from '@/graphql/mutations';
import { validateRecordImageFile } from '../utils/imageValidator';
import { compressImage, createThumbnail } from '../utils/imageCompressor';
import { toThumbnailFileName } from '../lib/thumbnailKey';
import { TEMP_OBJECT_TAGGING, isTemporaryKey } from '../lib/tempImageKey';
import { copyRecordImages } from '../lib/copyRecordImages';

const client = generateClient();

/** 最大画像数 */
const MAX_IMAGES = 5;

/**
 * 画像として読み込めなかったときの警告。
 *
 * 保存自体は通す（写真を残せる方が損が小さい）が、縮小もサムネイル生成も
 * できていないことは伝える。黙って通すと、一覧が原画を読み続ける状態に
 * 誰も気づけない（Issue #137）
 */
const UNREADABLE_WARNING =
  'この画像は読み取れませんでした。原寸のまま保存されるため、一覧の表示が重くなります';

/** サムネイルを用意できなかったときの警告 */
const THUMBNAIL_WARNING =
  '一覧用の縮小画像を作れませんでした。一覧では原寸の画像が読み込まれます';

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
  /** 保存は成立したが品質が落ちている場合の警告（読み込み不可・サムネイル未生成） */
  warning: string | null;
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
  /** OCR 用の事前アップロード（最初の1枚のみ）。後方互換用 */
  preUploadImage: (recordType: string) => Promise<string | null>;
  /** OCR 用の事前アップロード（選択中の全画像）。アップロード済みのキーは再利用する */
  preUploadImages: (recordType: string) => Promise<string[]>;
  /** 画像クリア */
  clearImage: () => void;
}

export function useImageUpload(): UseImageUploadReturn {
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageKeys, setImageKeys] = useState<string[]>([]);

  /**
   * アップロード中かを同期的に見るための控え。
   *
   * state は次の描画まで反映されないため、開始直後に届いた削除操作を
   * 取りこぼす。進行中の処理は自分の位置を覚えているので、そこで詰められると
   * 別の画像に警告が付く
   */
  const uploadingRef = useRef(false);

  /**
   * 選択済み＋圧縮中の枚数。
   *
   * 上限を state の imageFiles.length で見ると、複数ファイルを一度に選んだとき
   * すべての呼び出しが同じ描画時点の値を見るため、全部が検査を通ってしまう
   * （ファイル選択もドラッグ＆ドロップも 1 枚ずつこの関数を呼ぶ）
   */
  const selectedCountRef = useRef(0);

  const beginUpload = () => {
    uploadingRef.current = true;
    setIsUploading(true);
  };

  const endUpload = () => {
    uploadingRef.current = false;
    setIsUploading(false);
  };

  /**
   * 警告は画像ごとに持つ（imageFiles と同じ並び）。
   *
   * 1 つの箱に入れて上書きすると、選んだ画像を外しても警告が残り、
   * 逆に新しい画像を足すと前の画像の問題が消える。どちらも「今ある画像の
   * 状態」と食い違う。並びを揃えておけば、外したときに一緒に落とせる
   */
  const [fileWarnings, setFileWarnings] = useState<(string | null)[]>([]);

  // 後方互換用
  const imageFile = imageFiles[0] ?? null;
  const imageKey = imageKeys[0] ?? null;

  /**
   * 表示する警告。
   *
   * 読み込めなかった画像は縮小もサムネイル生成もできていないため、
   * サムネイルだけ失敗した場合より状態が悪い。両方あるときは前者を出す
   */
  const warning = useMemo(() => {
    // `!== null` では判定が足りない。配列に穴が空くと undefined が入り、
    // それが通り抜けて画面に "undefined" と表示される
    const active = fileWarnings.filter((w): w is string => typeof w === 'string');
    if (active.length === 0) return null;
    return active.includes(UNREADABLE_WARNING) ? UNREADABLE_WARNING : active[0];
  }, [fileWarnings]);

  const setImageFile = useCallback((file: File | null) => {
    selectedCountRef.current = file ? 1 : 0;
    if (file) {
      setImageFiles([file]);
      // 警告は imageFiles と同じ並びで持つ決まり。ここで揃えないと
      // 前の画像の警告が新しい画像のものとして表示される
      setFileWarnings([null]);
    } else {
      setImageFiles([]);
      setFileWarnings([]);
    }
  }, []);

  const handleImageSelect = useCallback(async (file: File) => {
    // 最大枚数チェック。state ではなく控えを見る（同時に複数選んだときの取りこぼし対策）
    if (selectedCountRef.current >= MAX_IMAGES) {
      setError(`画像は最大${MAX_IMAGES}枚まで添付できます`);
      return;
    }

    // バリデーション
    const validation = validateRecordImageFile(file);
    if (!validation.valid) {
      setError(validation.error);
      return;
    }

    setError(null);
    // 枠は圧縮の前に押さえる。await の間に別のファイルが同じ枠を取るため
    selectedCountRef.current += 1;

    // 長辺の正規化と 5MB 超の圧縮（必要ない画像はそのまま返る）
    setIsCompressing(true);
    try {
      const result = await compressImage(file);
      // 読めなかった画像はそのまま保存される。縮小もサムネイルも無い状態を
      // 選んだ時点で伝えないと、一覧が重くなった理由を後から辿れない
      setImageFiles((prev) => [...prev, result.file]);
      setFileWarnings((prev) => [
        ...prev,
        result.wasReadable ? null : UNREADABLE_WARNING,
      ]);
    } catch (err) {
      // 追加できなかったので枠を返す
      selectedCountRef.current -= 1;
      const message =
        err instanceof Error
          ? err.message
          : '画像の圧縮に失敗しました。5MB以下の画像を選択してください';
      setError(message);
    } finally {
      setIsCompressing(false);
    }
  }, []);

  const removeImage = useCallback(
    (index: number) => {
      // アップロード中は受け付けない。進行中の処理は自分の位置を覚えていて
      // 完了時にその位置へ警告を書くため、途中で詰めると別の画像に付く。
      // UI もボタンを隠しているが、状態の更新が反映されるまでの隙間がある
      if (uploadingRef.current) return;

      // 控えの更新は更新関数の外で行う。React は開発時に更新関数を
      // 2 回呼ぶことがあり、中で数を動かすと twice 引かれる
      selectedCountRef.current = Math.max(0, selectedCountRef.current - 1);

      setImageFiles((prev) => prev.filter((_, i) => i !== index));
      setImageKeys((prev) => prev.filter((_, i) => i !== index));
      // 外した画像の警告も一緒に落とす。残すと、もう無い画像について
      // 警告し続けることになる
      setFileWarnings((prev) => prev.filter((_, i) => i !== index));
    },
    [],
  );

  /**
   * S3 へ1ファイルを PUT してキーを返す。
   *
   * temporary を立てると記録に紐づく前の一時領域へ置く。サーバー側が署名に
   * タグを含めるため、同じ値を x-amz-tagging で送らないと 403 になる
   */
  const putToS3 = async (
    file: File,
    recordType: string,
    recordId: string,
    temporary = false,
    /** サムネイルとして置く場合の元画像のファイル名。キーはサーバー側が導出する */
    thumbnailOf?: string,
  ): Promise<string | null> => {
    const result = await client.graphql({
      query: generateUploadUrl,
      variables: {
        recordType,
        recordId,
        contentType: file.type,
        // サムネイルでも原画の名前を送る。`thumb_` 付きの名前を送れる状態だと、
        // サーバー側で原画とサムネイルを区別できない
        fileName: thumbnailOf ?? file.name,
        temporary,
        thumbnail: thumbnailOf !== undefined,
      },
    });

    if ('errors' in result && result.errors && result.errors.length > 0) {
      console.error('generateUploadUrl errors:', result.errors);
      return null;
    }

    const { uploadUrl, key } = (result as { data: { generateUploadUrl: { uploadUrl: string; key: string } } }).data.generateUploadUrl;

    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type,
        ...(temporary ? { 'x-amz-tagging': TEMP_OBJECT_TAGGING } : {}),
      },
      body: file,
    });

    if (!uploadResponse.ok) {
      console.error('S3 upload failed:', uploadResponse.status);
      return null;
    }

    return key;
  };

  /**
   * 一覧表示用のサムネイルを原画の兄弟キーとして保存する。
   *
   * 記録に保存するのは原画キーのみで、表示側はそこからサムネイルキーを
   * 導出する。失敗しても原画へフォールバックできるため、登録処理は止めない。
   *
   * ただし「止めない」と「黙る」は別。呼び出し側が結果を見て利用者に伝える。
   * putToS3 は失敗を例外ではなく null で返すため、戻り値を捨てると
   * アップロードできていないのに成功扱いになる
   *
   * @returns サムネイルを保存できたか
   */
  const uploadThumbnail = async (
    file: File,
    recordType: string,
    recordId: string,
    temporary = false,
  ): Promise<boolean> => {
    try {
      const thumbnail = await createThumbnail(
        file,
        toThumbnailFileName(file.name),
      );
      return (
        (await putToS3(thumbnail, recordType, recordId, temporary, file.name)) !== null
      );
    } catch (err) {
      console.error('サムネイルの生成・アップロードに失敗しました:', err);
      return false;
    }
  };

  /**
   * 単一ファイルのアップロード処理（原画＋サムネイル）。
   *
   * index は警告を画像に紐づけるための位置。1 枚失敗しただけで
   * 全部に警告が付いたり、成功した画像の分まで残ったりしないようにする
   */
  const uploadSingleFile = async (
    file: File,
    recordType: string,
    recordId: string,
    index: number,
    temporary = false,
  ): Promise<string | null> => {
    const key = await putToS3(file, recordType, recordId, temporary);
    if (key === null) return null;

    // サムネイルも原画と同じ置き場に揃える。原画だけ一時領域に置くと、
    // 複製時にサムネイルが見つからず一覧が原画へフォールバックする
    if (!(await uploadThumbnail(file, recordType, recordId, temporary))) {
      setFileWarnings((prev) => {
        // その画像がもう選ばれていないなら書かない。範囲外へ代入すると
        // 配列に穴が空き、undefined が警告として表示される
        if (index >= prev.length) return prev;

        const next = [...prev];
        // 読み込めていない画像には、より状態の悪い方の警告を残す
        if (next[index] == null) next[index] = THUMBNAIL_WARNING;
        return next;
      });
    }
    return key;
  };

  const uploadImages = useCallback(
    async (recordType: string, recordId: string): Promise<string[]> => {
      if (imageFiles.length === 0) return [];

      // 全ファイル分のキーが揃っているか（OCR の事前アップロード済みなど）
      const allUploaded =
        imageKeys.length === imageFiles.length && imageKeys.every((k) => k);

      beginUpload();
      try {
        let keys: string[];

        if (allUploaded) {
          keys = imageKeys;
        } else {
          keys = [];
          for (let i = 0; i < imageFiles.length; i++) {
            // OCR 事前アップロード等で既に key がある場合は再利用
            const existing = imageKeys[i];
            if (existing) {
              keys.push(existing);
              continue;
            }
            const key = await uploadSingleFile(imageFiles[i], recordType, recordId, i);
            if (key === null) {
              setError('画像のアップロードに失敗しました。もう一度お試しください');
              return [];
            }
            keys.push(key);
          }
        }

        // 一時領域のキーは記録に持たせられない。ライフサイクルで実体が消えて
        // 記録だけが画像を指したまま残る。正式な場所へ複製してから返す（Issue #140）。
        // 複製できなかった場合は登録を止める。消えると分かっている画像を
        // 記録に紐づけるより、やり直してもらう方がよい
        const finalKeys = keys.some(isTemporaryKey)
          ? await copyRecordImages(
              keys,
              recordType as 'purchase' | 'drinking',
              recordId,
            )
          : keys;

        setImageKeys(finalKeys);
        return finalKeys;
      } catch (err) {
        console.error('Image upload failed:', err);
        setError('画像のアップロードに失敗しました。もう一度お試しください');
        return [];
      } finally {
        endUpload();
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

  const preUploadImages = useCallback(
    async (recordType: string): Promise<string[]> => {
      if (imageFiles.length === 0) return [];

      // 全ファイル分のキーが揃っている場合はそれを返す
      if (imageKeys.length === imageFiles.length && imageKeys.every((k) => k)) {
        return imageKeys;
      }

      beginUpload();
      try {
        const tempRecordId = crypto.randomUUID();
        const keys: string[] = [];
        for (let i = 0; i < imageFiles.length; i++) {
          // 既にアップロード済みのキーは再利用
          const existing = imageKeys[i];
          if (existing) {
            keys.push(existing);
            continue;
          }
          const key = await uploadSingleFile(
            imageFiles[i],
            recordType,
            tempRecordId,
            i,
            true,
          );
          if (key === null) {
            setError('画像のアップロードに失敗しました。もう一度お試しください');
            return [];
          }
          keys.push(key);
        }
        setImageKeys(keys);
        return keys;
      } catch (err) {
        console.error('Image pre-upload failed:', err);
        setError('画像のアップロードに失敗しました。もう一度お試しください');
        return [];
      } finally {
        endUpload();
      }
    },
    [imageFiles, imageKeys],
  );

  // 後方互換: 最初の1枚のキーを返す
  const preUploadImage = useCallback(
    async (recordType: string): Promise<string | null> => {
      const keys = await preUploadImages(recordType);
      return keys[0] ?? null;
    },
    [preUploadImages],
  );

  const clearImage = useCallback(() => {
    selectedCountRef.current = 0;
    setImageFiles([]);
    setError(null);
    setFileWarnings([]);
    setImageKeys([]);
  }, []);

  return {
    imageFile,
    imageFiles,
    setImageFile,
    isCompressing,
    isUploading,
    error,
    warning,
    imageKey,
    imageKeys,
    handleImageSelect,
    removeImage,
    uploadImage,
    uploadImages,
    preUploadImage,
    preUploadImages,
    clearImage,
  };
}
