import type { UnifiedRecord } from '@/features/records/types';
import { SPEC_FIELD_NAMES } from '../types';

/**
 * 写真から詳細スペックを読み取る一括処理（Issue #87 の後追い）の対象を選ぶ。
 *
 * 対象は「写真が付いている」「詳細スペックがまだ1つも入っていない」の両方を
 * 満たすもの。購入記録と飲酒記録の区別はしない。テイスティングノートの一括追記が
 * 飲酒記録を外しているのは備考が本人の言葉だからで、スペックは瓶に印刷された
 * 事実なので、どちらの記録でも同じように埋めてよい。
 *
 * 「1つも入っていない」を条件にするのは、バナーが消えるようにするため。
 * 「1つでも欠けている」を条件にすると、ビールに精米歩合が入ることは無いので
 * 対象がいつまでも残り続ける
 */
export function selectSpecBackfillTargets(records: UnifiedRecord[]): UnifiedRecord[] {
  return records.filter(
    (record) => record.imageKeys.length > 0 && !hasAnyRecordSpec(record),
  );
}

/** 記録が詳細スペックを1つでも持っているか */
export function hasAnyRecordSpec(record: UnifiedRecord): boolean {
  const specs = record.specs;
  return specs !== undefined && SPEC_FIELD_NAMES.some((key) => specs[key] != null);
}

/**
 * 「読み取れなかった記録」を控えるための鍵。
 *
 * 記録IDと画像キーの組みにする。OCR は temperature 0 で走るので、同じ画像を
 * 投げれば答えも同じになる。IDだけで覚えると、あとから裏ラベルの写真を足しても
 * 対象に戻らず、読み取り直す道が無くなる。写真を足せば別の鍵になり、
 * 次の一括読み取りでもう一度試される
 */
export function specSkipKey(record: UnifiedRecord): string {
  return `${record.id}:${record.imageKeys.join(',')}`;
}
