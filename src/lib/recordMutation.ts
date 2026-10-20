import { useState } from 'react';
import { generateClient } from 'aws-amplify/api';
import type { SaveResult } from '@/features/purchase/types';

/**
 * 購入・飲酒の記録を作成・更新する mutation の呼び出し口。
 *
 * どちらの保存フックも「送る → errors を見る → 失敗なら固定の文言で返す →
 * isSaving を戻す」が同じなので、input の組み立てだけを各フックに残す。
 */

const client = generateClient();

export const CREATE_FAILED_MESSAGE = '登録に失敗しました。もう一度お試しください';
export const UPDATE_FAILED_MESSAGE = '更新に失敗しました。もう一度お試しください';

export interface RecordImageOptions {
  imageKey?: string | null;
  imageKeys?: string[];
}

/**
 * 作成時の画像の項目。空配列は送らない（サーバー側で弾かれる）
 */
export function imageFieldsForCreate(options?: RecordImageOptions) {
  return {
    imageKey: options?.imageKey ?? null,
    imageKeys: options?.imageKeys?.length ? options.imageKeys : undefined,
  };
}

/**
 * 更新時の画像の項目。
 *
 * 画像を触らない更新では送らない。undefined を送ると
 * 既存のキーを消してしまう（更新式は渡されたフィールドだけを SET する）
 * 空配列は送らない。サーバー側で弾かれるうえ、意味としても
 * 「画像を触らない更新」と区別が付かない（作成側と揃える）
 */
export function imageFieldsForUpdate(options?: RecordImageOptions) {
  return options?.imageKeys?.length
    ? { imageKey: options.imageKey ?? null, imageKeys: options.imageKeys }
    : {};
}

export interface RunMutationOptions {
  /** ログに出す操作名（例: 'PurchaseRecord create'） */
  logLabel: string;
  /** 失敗したときに画面へ返す文言 */
  failureMessage: string;
}

export interface UseRecordMutationReturn {
  run: (
    query: string,
    input: Record<string, unknown>,
    options: RunMutationOptions,
  ) => Promise<SaveResult>;
  isSaving: boolean;
}

export function useRecordMutation(): UseRecordMutationReturn {
  const [isSaving, setIsSaving] = useState(false);

  const run = async (
    query: string,
    input: Record<string, unknown>,
    { logLabel, failureMessage }: RunMutationOptions,
  ): Promise<SaveResult> => {
    setIsSaving(true);
    try {
      const result = await client.graphql({ query, variables: { input } });

      if ('errors' in result && result.errors && result.errors.length > 0) {
        console.error(`${logLabel} errors:`, result.errors);
        return { success: false, error: failureMessage };
      }

      return { success: true };
    } catch (error) {
      console.error(`${logLabel} failed:`, error);
      return { success: false, error: failureMessage };
    } finally {
      setIsSaving(false);
    }
  };

  return { run, isSaving };
}
