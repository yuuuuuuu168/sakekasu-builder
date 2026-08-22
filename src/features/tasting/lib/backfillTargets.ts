import type { UnifiedRecord } from '@/features/records/types';
import { hasTastingNote, supportsTastingNote } from './tastingNoteMemo';

/**
 * 一括追記の対象を選ぶ。
 *
 * 対象は「購入記録」「ウイスキーか日本酒」「まだノートが書かれていない」の
 * すべてを満たすもの。飲酒記録を外しているのは、備考が飲んだときの感想欄で、
 * 後から機械が書いた文章を混ぜると自分の言葉と見分けが付かなくなるため。
 *
 * 銘柄名が空の記録も外す。名前が無ければノートの起こしようがない
 */
export function selectTastingNoteTargets(records: UnifiedRecord[]): UnifiedRecord[] {
  return records.filter(
    (record) =>
      record.type === 'purchase' &&
      supportsTastingNote(record.category) &&
      record.sakeName.trim() !== '' &&
      !hasTastingNote(record.memo),
  );
}
