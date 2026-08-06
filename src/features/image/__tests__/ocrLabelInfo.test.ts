import { describe, it, expect } from 'vitest';
import { formatLabelInfoForMemo, appendLabelInfoToMemo } from '../lib/ocrLabelInfo';

describe('formatLabelInfoForMemo', () => {
  it('産地と度数の両方があるとき1行に整形する', () => {
    expect(formatLabelInfoForMemo({ region: '山口県', alcoholPercentage: 16 })).toBe(
      '産地: 山口県 / アルコール度数: 16%',
    );
  });

  it('産地のみのとき産地だけを整形する', () => {
    expect(formatLabelInfoForMemo({ region: '新潟県', alcoholPercentage: null })).toBe(
      '産地: 新潟県',
    );
  });

  it('度数のみのとき度数だけを整形する', () => {
    expect(formatLabelInfoForMemo({ region: null, alcoholPercentage: 43 })).toBe(
      'アルコール度数: 43%',
    );
  });

  it('どちらも未検出なら null を返す', () => {
    expect(formatLabelInfoForMemo({ region: null, alcoholPercentage: null })).toBeNull();
  });
});

describe('appendLabelInfoToMemo', () => {
  it('空のメモにはそのまま設定する', () => {
    expect(appendLabelInfoToMemo('', { region: '山口県', alcoholPercentage: 16 })).toBe(
      '産地: 山口県 / アルコール度数: 16%',
    );
  });

  it('既存メモには改行して追記する', () => {
    expect(
      appendLabelInfoToMemo('お土産でもらった', { region: '山口県', alcoholPercentage: 16 }),
    ).toBe('お土産でもらった\n産地: 山口県 / アルコール度数: 16%');
  });

  it('同じ内容が既にあるときは追記しない（OCR 再実行対策）', () => {
    const memo = '産地: 山口県 / アルコール度数: 16%';
    expect(appendLabelInfoToMemo(memo, { region: '山口県', alcoholPercentage: 16 })).toBe(memo);
  });

  it('どちらも未検出ならメモを変更しない', () => {
    expect(appendLabelInfoToMemo('メモ', { region: null, alcoholPercentage: null })).toBe('メモ');
  });
});
