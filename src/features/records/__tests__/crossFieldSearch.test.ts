import { describe, it, expect } from 'vitest';
import { filterRecords } from '../hooks/useRecordFilter';
import { DEFAULT_FILTERS, type UnifiedRecord, type RecordFilters } from '../types';

function search(query: string): RecordFilters {
  return { ...DEFAULT_FILTERS, searchQuery: query };
}

const purchase: UnifiedRecord = {
  id: 'p-1',
  type: 'purchase',
  sakeName: '獺祭 純米大吟醸',
  price: 3000,
  date: '2026-01-10',
  category: 'NIHONSHU',
  storeName: 'カクヤス 渋谷店',
  memo: 'ボーナスで奮発した',
  imageKeys: [],
  createdAt: '2026-01-10T00:00:00.000Z',
  updatedAt: '2026-01-10T00:00:00.000Z',
};

const drinking: UnifiedRecord = {
  id: 'd-1',
  type: 'drinking',
  sakeName: '久保田 千寿',
  price: 800,
  date: '2026-01-11',
  category: 'NIHONSHU',
  placeName: '居酒屋とんぼ',
  drinkingMethod: '燗',
  rating: 4,
  memo: 'すき焼きと合わせた',
  imageKeys: [],
  createdAt: '2026-01-11T00:00:00.000Z',
  updatedAt: '2026-01-11T00:00:00.000Z',
};

const records = [purchase, drinking];

describe('キーワード検索の横断', () => {
  it('酒名で引ける', () => {
    expect(filterRecords(records, search('獺祭'))).toEqual([purchase]);
  });

  it('酒名は曖昧検索が効く（間の文字を飛ばしても引ける）', () => {
    expect(filterRecords(records, search('獺大吟'))).toEqual([purchase]);
  });

  it('店名で引ける', () => {
    expect(filterRecords(records, search('カクヤス'))).toEqual([purchase]);
  });

  it('場所名で引ける', () => {
    expect(filterRecords(records, search('とんぼ'))).toEqual([drinking]);
  });

  it('飲み方で引ける', () => {
    expect(filterRecords(records, search('燗'))).toEqual([drinking]);
  });

  it('メモで引ける', () => {
    expect(filterRecords(records, search('すき焼き'))).toEqual([drinking]);
  });

  it('大文字小文字を区別しない', () => {
    const english: UnifiedRecord = { ...drinking, id: 'd-2', placeName: 'Bar Moon' };
    expect(filterRecords([english], search('bar moon'))).toEqual([english]);
  });

  it('酒名以外は部分一致なので、離れた文字の拾い読みでは引っかからない', () => {
    // 「すきと」は memo「すき焼きと合わせた」に順番には出現するが、連続はしていない
    expect(filterRecords(records, search('すきと'))).toEqual([]);
  });

  it('どこにも無いキーワードは0件になる', () => {
    expect(filterRecords(records, search('ワイン'))).toEqual([]);
  });

  it('前後の空白は無視する', () => {
    expect(filterRecords(records, search('  獺祭  '))).toEqual([purchase]);
  });

  it('カテゴリ絞り込みとAND条件で効く', () => {
    const whisky: UnifiedRecord = { ...purchase, id: 'p-2', category: 'WHISKY' };
    const result = filterRecords([purchase, whisky], {
      ...DEFAULT_FILTERS,
      searchQuery: '獺祭',
      category: 'WHISKY',
    });
    expect(result).toEqual([whisky]);
  });
});
