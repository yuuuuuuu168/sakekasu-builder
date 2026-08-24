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
  specs: {
    brewery: '旭酒造株式会社',
    region: '山口県',
    alcoholPercentage: 16,
    volumeMl: 720,
    specificName: '純米大吟醸',
    ricePolishingRatio: 23,
    sakeMeterValue: null,
    acidity: null,
    aminoAcidity: null,
    riceVariety: '山田錦',
    yeast: '協会9号',
    labelDescription: '洗練された香りと透明感のある味わい。',
  },
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

describe('表記ゆれを越えた検索', () => {
  const arran: UnifiedRecord = {
    ...purchase,
    id: 'p-arran',
    sakeName: 'アラン 10年',
    storeName: 'リカーショップ',
    memo: undefined,
  };

  // 人間様から挙がった実例
  it.each(['アラン', 'あらん', 'ｱﾗﾝ', 'Allan', 'Arran', 'ARRAN', 'ＡＲＲＡＮ'])(
    '「%s」で「アラン 10年」を引ける',
    (query) => {
      expect(filterRecords([arran], search(query))).toEqual([arran]);
    },
  );

  it('英字表記の記録をカタカナで引ける（逆方向）', () => {
    const bowmore: UnifiedRecord = { ...purchase, id: 'p-bw', sakeName: 'Yamazaki 12' };
    expect(filterRecords([bowmore], search('ヤマザキ'))).toEqual([bowmore]);
  });

  it('店名やメモの表記ゆれも吸収する', () => {
    const rec: UnifiedRecord = {
      ...purchase,
      id: 'p-store',
      sakeName: '獺祭',
      storeName: 'カクヤス',
      memo: 'ぼうもあ と一緒に購入',
    };
    expect(filterRecords([rec], search('かくやす'))).toEqual([rec]);
    expect(filterRecords([rec], search('ボウモア'))).toEqual([rec]);
  });

  // 表記ゆれ対応で網を広げた結果、無関係な記録まで拾わないこと
  it('別の銘柄は引っかからない', () => {
    const kirin: UnifiedRecord = { ...purchase, id: 'p-kirin', sakeName: 'キリン', memo: undefined };
    expect(filterRecords([kirin], search('アラン'))).toEqual([]);

    const kaku: UnifiedRecord = { ...purchase, id: 'p-kaku', sakeName: 'カク', memo: undefined };
    expect(filterRecords([kaku], search('コク'))).toEqual([]);
  });

  it('従来の曖昧検索は引き続き効く', () => {
    expect(filterRecords(records, search('獺大吟'))).toEqual([purchase]);
  });
});

// Feature: 詳細スペック項目の記録対応（Issue #87）: スペックからも記録を探せる
describe('詳細スペックの横断', () => {
  it('蔵元で引ける', () => {
    expect(filterRecords(records, search('旭酒造'))).toEqual([purchase]);
  });

  it('産地で引ける', () => {
    expect(filterRecords(records, search('山口県'))).toEqual([purchase]);
  });

  it('酒米で引ける', () => {
    expect(filterRecords(records, search('山田錦'))).toEqual([purchase]);
  });

  it('酵母で引ける', () => {
    expect(filterRecords(records, search('協会9号'))).toEqual([purchase]);
  });

  it('紹介文は検索対象にしない（ありふれた語で無関係な記録が並ぶため）', () => {
    expect(filterRecords(records, search('透明感'))).toEqual([]);
  });
});
