import { compressImage } from '@/features/image/utils/imageCompressor';
import { validateImageFile } from '@/features/image/utils/imageValidator';
import type { ChatImageFormat, ChatImagePayload } from '../types';

/** 1回の相談に添付できる画像の最大枚数（エージェント側の上限と揃える） */
export const MAX_CHAT_IMAGES = 3;

/** 送信用の base64 とプレビュー用の dataURL をまとめた添付画像 */
export interface PreparedChatImage extends ChatImagePayload {
  /** プレビュー表示に使う dataURL */
  dataUrl: string;
}

/**
 * dataURL を送信用の形式と base64 本体に分解する。
 * 対応形式（JPEG / PNG）以外や dataURL でない文字列は null。
 */
export function splitDataUrl(
  dataUrl: string,
): { format: ChatImageFormat; data: string } | null {
  const match = /^data:image\/(jpeg|png);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { format: match[1] as ChatImageFormat, data: match[2] };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('画像の読み込みに失敗しました'));
      }
    };
    reader.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    reader.readAsDataURL(file);
  });
}

/**
 * 添付画像を検証・圧縮して送信できる形へ変換する。
 *
 * 記録用の画像アップロードと同じ圧縮（長辺 1568px = Claude vision の
 * 推奨上限、5MB 以下）を通すため、巨大な写真をそのまま送ることはない。
 *
 * @throws 対応形式でない・変換に失敗した場合（メッセージは画面表示に使える文言）
 */
export async function prepareChatImage(file: File): Promise<PreparedChatImage> {
  const validation = validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.error ?? '対応していない画像形式です');
  }

  const { file: compressed } = await compressImage(file);
  const dataUrl = await readAsDataUrl(compressed);
  const parsed = splitDataUrl(dataUrl);
  if (!parsed) {
    throw new Error('画像の変換に失敗しました');
  }
  return { ...parsed, dataUrl };
}
