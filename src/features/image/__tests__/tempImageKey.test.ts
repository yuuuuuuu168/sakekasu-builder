import { describe, it, expect } from 'vitest';
import { isTemporaryKey, TEMP_LOCATION } from '../lib/tempImageKey';

describe('isTemporaryKey', () => {
  it('一時領域のキーを判定する', () => {
    expect(isTemporaryKey('sub-1/tmp/upload-1/a.jpg')).toBe(true);
  });

  it('記録に紐づいたキーは対象外', () => {
    expect(isTemporaryKey('sub-1/purchase/rec-1/a.jpg')).toBe(false);
    expect(isTemporaryKey('sub-1/drinking/rec-1/a.jpg')).toBe(false);
  });

  it('サムネイルでも位置で判定する', () => {
    expect(isTemporaryKey('sub-1/tmp/upload-1/thumb_a.jpg')).toBe(true);
    expect(isTemporaryKey('sub-1/purchase/rec-1/thumb_a.jpg')).toBe(false);
  });

  // 「tmp」がファイル名や sub に現れても一時領域とは限らない。
  // 判定を前方一致や includes にすると、正式な画像を消える扱いにしてしまう
  it('区画以外の位置にある tmp は一時領域とみなさない', () => {
    expect(isTemporaryKey('sub-1/purchase/rec-1/tmp.jpg')).toBe(false);
    expect(isTemporaryKey('tmp/purchase/rec-1/a.jpg')).toBe(false);
    expect(isTemporaryKey('sub-1/purchase/tmp/a.jpg')).toBe(false);
  });

  it('区画を持たないキーは一時領域ではない', () => {
    expect(isTemporaryKey('a.jpg')).toBe(false);
    expect(isTemporaryKey('')).toBe(false);
  });

  it('区画名はサーバー側の定義と揃っている', () => {
    expect(TEMP_LOCATION).toBe('tmp');
  });
});
