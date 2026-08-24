// Feature: 既存の記録に写真から詳細スペックを入れる（Issue #87 の後追い）

import { describe, it, expect } from 'vitest';
import {
  hasAnyRecordSpec,
  selectSpecBackfillTargets,
  specSkipKey,
} from '../lib/backfillTargets';
import { pickSakeSpecs } from '../lib/sakeSpecs';
import type { UnifiedRecord } from '@/features/records/types';

function record(overrides: Partial<UnifiedRecord> = {}): UnifiedRecord {
  return {
    id: 'p-1',
    type: 'purchase',
    sakeName: '獺祭 純米大吟醸',
    price: 3300,
    date: '2026-01-10',
    category: 'NIHONSHU',
    imageKeys: ['sub-1/purchase/p-1/front.jpg'],
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('selectSpecBackfillTargets', () => {
  it('写真があってスペックが空の記録を選ぶ', () => {
    const target = record();

    expect(selectSpecBackfillTargets([target])).toEqual([target]);
  });

  it('写真の無い記録は選ばない（読み取る元が無い）', () => {
    expect(selectSpecBackfillTargets([record({ imageKeys: [] })])).toEqual([]);
  });

  it('スペックが1つでも入っている記録は選ばない', () => {
    const filled = record({ specs: pickSakeSpecs({ brewery: '旭酒造株式会社' }) });

    expect(selectSpecBackfillTargets([filled])).toEqual([]);
  });

  it('全項目 null のスペックを持つ記録は「空」として選ぶ', () => {
    const empty = record({ specs: pickSakeSpecs({}) });

    expect(selectSpecBackfillTargets([empty])).toEqual([empty]);
  });

  it('飲酒記録も対象にする（スペックは本人の言葉ではなく瓶の事実なので）', () => {
    const drinking = record({ id: 'd-1', type: 'drinking' });

    expect(selectSpecBackfillTargets([drinking])).toEqual([drinking]);
  });
});

describe('hasAnyRecordSpec', () => {
  it('スペックの項目自体が無い記録は false', () => {
    expect(hasAnyRecordSpec(record())).toBe(false);
  });

  it('数値の 0 も「入っている」とみなす（日本酒度 ±0）', () => {
    expect(hasAnyRecordSpec(record({ specs: pickSakeSpecs({ sakeMeterValue: 0 }) }))).toBe(true);
  });
});

describe('specSkipKey', () => {
  it('画像が変われば別の鍵になる（裏ラベルを足せばもう一度試される）', () => {
    const before = specSkipKey(record());
    const after = specSkipKey(
      record({ imageKeys: ['sub-1/purchase/p-1/front.jpg', 'sub-1/purchase/p-1/back.jpg'] }),
    );

    expect(before).not.toBe(after);
  });

  it('同じ記録・同じ画像なら同じ鍵になる', () => {
    expect(specSkipKey(record())).toBe(specSkipKey(record()));
  });
});
