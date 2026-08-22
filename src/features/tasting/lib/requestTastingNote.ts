import { generateClient } from 'aws-amplify/api';
import { generateTastingNote } from '@/graphql/mutations';
import type { NotableCategory, TastingNote } from './tastingNoteMemo';

const client = generateClient();

/** 何も書けなかったときの戻り値。呼び出し側は失敗と同じ扱いでよい */
const EMPTY_NOTE: TastingNote = { tastingNote: null, recommendedServing: null };

/**
 * 銘柄名からテイスティングノートを取り寄せる。
 *
 * **失敗しても投げない。** これは記録の登録に付随する処理で、ノートが取れない
 * ことを理由に登録そのものを止めたくない。取れなければ空のまま返し、
 * 備考には何も足さずに保存を続ける
 */
export async function requestTastingNote(
  sakeName: string,
  category: NotableCategory,
): Promise<TastingNote> {
  try {
    const result = await client.graphql({
      query: generateTastingNote,
      variables: { sakeName, category },
    });

    if ('errors' in result && result.errors && result.errors.length > 0) {
      console.error('generateTastingNote errors:', result.errors);
      return EMPTY_NOTE;
    }

    const data = (result as { data?: { generateTastingNote?: TastingNote | null } }).data
      ?.generateTastingNote;

    return {
      tastingNote: data?.tastingNote ?? null,
      recommendedServing: data?.recommendedServing ?? null,
    };
  } catch (error) {
    console.error('generateTastingNote failed:', error);
    return EMPTY_NOTE;
  }
}
