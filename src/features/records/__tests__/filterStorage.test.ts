import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  loadFilterState,
  saveFilterState,
  clearFilterState,
  DEFAULT_FILTER_STATE,
  type PersistedFilterState,
} from '../lib/filterStorage';

const USER = 'user-abc';
const KEY = `sakekasu:record-filters:${USER}`;

const customState: PersistedFilterState = {
  recordType: 'drinking',
  category: 'WHISKY',
  searchQuery: '山崎',
  drinkingStatus: 'all',
  rating: 4,
  sortOption: 'rating-desc',
};

describe('絞り込み条件の保存と復元', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('保存した条件をそのまま復元できる', () => {
    saveFilterState(USER, customState);
    expect(loadFilterState(USER)).toEqual(customState);
  });

  it('保存が無ければ既定値を返す', () => {
    expect(loadFilterState(USER)).toEqual(DEFAULT_FILTER_STATE);
  });

  it('ユーザーが違えば互いの条件は見えない', () => {
    saveFilterState(USER, customState);
    expect(loadFilterState('other-user')).toEqual(DEFAULT_FILTER_STATE);
  });

  it('ユーザーIDが空なら保存も復元もしない', () => {
    saveFilterState('', customState);
    expect(localStorage.length).toBe(0);
    expect(loadFilterState('')).toEqual(DEFAULT_FILTER_STATE);
  });

  it('削除すると既定値に戻る', () => {
    saveFilterState(USER, customState);
    clearFilterState(USER);
    expect(loadFilterState(USER)).toEqual(DEFAULT_FILTER_STATE);
  });

  it('壊れたJSONが入っていても既定値を返す', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem(KEY, '{壊れている');
    expect(loadFilterState(USER)).toEqual(DEFAULT_FILTER_STATE);
  });

  it('選択肢に無い値は項目ごとに既定値へ落とす', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        recordType: 'unknown',
        category: 'WHISKY',
        searchQuery: 42,
        drinkingStatus: 'NOT_STARTED',
        rating: 9,
        sortOption: 'price-asc',
      }),
    );

    expect(loadFilterState(USER)).toEqual({
      recordType: 'all',
      category: 'WHISKY',
      searchQuery: '',
      drinkingStatus: 'NOT_STARTED',
      rating: 'all',
      sortOption: 'price-asc',
    });
  });

  it('配列など想定外の形が入っていても既定値を返す', () => {
    localStorage.setItem(KEY, JSON.stringify([1, 2, 3]));
    expect(loadFilterState(USER)).toEqual(DEFAULT_FILTER_STATE);
  });

  it('localStorage が使えなくても例外を投げない', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => saveFilterState(USER, customState)).not.toThrow();
  });
});
