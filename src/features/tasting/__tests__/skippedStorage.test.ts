/**
 * 「書けなかった記録」の控えのテスト。
 *
 * 控えは対象から外す判断に使うので、壊れた値や古い版を読んで
 * 記録を永久に対象外にしてしまわないことを見る。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadSkippedKeys, saveSkippedKeys, skipKey } from '../lib/skippedStorage';

const USER = 'user-1';
const STORAGE_KEY = `sakekasu:tasting-note-skipped:${USER}`;

describe('skipKey', () => {
  it('記録IDと銘柄名の組みで鍵を作る', () => {
    expect(skipKey('p-1', '獺祭 純米大吟醸')).toBe('p-1:獺祭 純米大吟醸');
  });

  it('銘柄名の前後の空白は無視する', () => {
    expect(skipKey('p-1', '  獺祭  ')).toBe(skipKey('p-1', '獺祭'));
  });

  // 銘柄名を直せば別の鍵になり、次の一括追記でもう一度試される
  it('銘柄名が違えば別の鍵になる', () => {
    expect(skipKey('p-1', '獺采')).not.toBe(skipKey('p-1', '獺祭'));
  });
});

describe('loadSkippedKeys / saveSkippedKeys', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('保存した鍵を読み出せる', () => {
    saveSkippedKeys(USER, ['p-1:獺祭']);

    expect(loadSkippedKeys(USER)).toEqual(['p-1:獺祭']);
  });

  it('保存を重ねても重複しない', () => {
    saveSkippedKeys(USER, ['p-1:獺祭']);
    saveSkippedKeys(USER, ['p-1:獺祭', 'p-2:山崎']);

    expect(loadSkippedKeys(USER)).toEqual(['p-1:獺祭', 'p-2:山崎']);
  });

  it('保存していなければ空', () => {
    expect(loadSkippedKeys(USER)).toEqual([]);
  });

  it('壊れた値は空として扱う', () => {
    for (const raw of ['{壊れた', '[]', '"text"', '{"keys":"x"}']) {
      localStorage.setItem(STORAGE_KEY, raw);
      expect(loadSkippedKeys(USER)).toEqual([]);
    }
  });

  // 生成の方式を変えたら版を上げる。古い控えは読み捨てられ、
  // 以前は書けなかった記録が自動でもう一度対象に入る
  it('版が違う控えは読み捨てる', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 0, keys: ['p-1:獺祭'] }));

    expect(loadSkippedKeys(USER)).toEqual([]);
  });

  it('ユーザーごとに分かれている', () => {
    saveSkippedKeys(USER, ['p-1:獺祭']);

    expect(loadSkippedKeys('user-2')).toEqual([]);
  });
});
