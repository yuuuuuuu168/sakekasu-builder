/**
 * 一括追記の対象選びのテスト。
 *
 * 対象を広く取りすぎると、書かなくていい記録にまで Bedrock を呼んで
 * 費用だけがかかる。狭すぎれば既存記録が置き去りになる。
 */
import { describe, it, expect } from 'vitest';
import { selectTastingNoteTargets } from '../lib/backfillTargets';
import type { UnifiedRecord } from '@/features/records/types';
import type { SakeCategory } from '@/features/purchase/types';

function record(overrides: Partial<UnifiedRecord> = {}): UnifiedRecord {
  return {
    id: 'p-1',
    type: 'purchase',
    sakeName: '山崎 12年',
    price: 12000,
    date: '2026-01-10',
    category: 'WHISKY',
    imageKeys: [],
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('selectTastingNoteTargets', () => {
  it('ノート未記載のウイスキー・日本酒の購入記録を選ぶ', () => {
    const targets = selectTastingNoteTargets([
      record({ id: 'w', category: 'WHISKY' }),
      record({ id: 'n', category: 'NIHONSHU' }),
    ]);

    expect(targets.map((r) => r.id)).toEqual(['w', 'n']);
  });

  it('ウイスキー・日本酒以外は選ばない', () => {
    const others: SakeCategory[] = ['BEER', 'WINE', 'SHOCHU', 'OTHER'];
    const targets = selectTastingNoteTargets(
      others.map((category, i) => record({ id: `o-${i}`, category })),
    );

    expect(targets).toEqual([]);
  });

  it('すでにノートがある記録は選ばない', () => {
    const targets = selectTastingNoteTargets([
      record({ id: 'done', memo: 'テイスティングノート: バニラの香り' }),
    ]);

    expect(targets).toEqual([]);
  });

  // 飲酒記録の備考は飲んだときの感想欄。機械が書いた文章を混ぜない
  it('飲酒記録は選ばない', () => {
    const targets = selectTastingNoteTargets([record({ id: 'd', type: 'drinking' })]);

    expect(targets).toEqual([]);
  });

  it('銘柄名が空の記録は選ばない', () => {
    const targets = selectTastingNoteTargets([record({ id: 'empty', sakeName: '  ' })]);

    expect(targets).toEqual([]);
  });
});
