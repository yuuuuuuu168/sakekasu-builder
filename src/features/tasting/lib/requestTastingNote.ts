import { generateClient } from 'aws-amplify/api';
import { generateTastingNote } from '@/graphql/mutations';
import type { NotableCategory, TastingNote } from './tastingNoteMemo';

const client = generateClient();

/**
 * 銘柄名からテイスティングノートを取り寄せる。
 *
 * **失敗しても投げない。** これは記録の登録に付随する処理で、ノートが取れない
 * ことを理由に登録そのものを止めたくない。取れなければ備考に何も足さずに
 * 保存を続ける。
 *
 * 戻り値は2種類を区別する。呼び出しそのものが失敗したときは `null`、
 * モデルが「その銘柄は知らない」と答えたときは中身が null のノート。
 * 前者はやり直せば結果が変わりうるが、後者は同じ銘柄名なら何度呼んでも同じで、
 * 一括追記が「書けなかった記録」を控えるかどうかの判断がここで分かれる
 */
export async function requestTastingNote(
  sakeName: string,
  category: NotableCategory,
): Promise<TastingNote | null> {
  try {
    const result = await client.graphql({
      query: generateTastingNote,
      variables: { sakeName, category },
    });

    if ('errors' in result && result.errors && result.errors.length > 0) {
      console.error('generateTastingNote errors:', result.errors);
      return null;
    }

    const data = (result as { data?: { generateTastingNote?: TastingNote | null } }).data
      ?.generateTastingNote;

    return {
      tastingNote: data?.tastingNote ?? null,
      recommendedServing: data?.recommendedServing ?? null,
    };
  } catch (error) {
    console.error('generateTastingNote failed:', error);
    return null;
  }
}
