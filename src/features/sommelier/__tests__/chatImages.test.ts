import { describe, it, expect } from 'vitest';
import { splitDataUrl, MAX_CHAT_IMAGES } from '../lib/chatImages';

describe('splitDataUrl', () => {
  it('JPEG の dataURL を形式と base64 本体に分解する', () => {
    expect(splitDataUrl('data:image/jpeg;base64,aGVsbG8=')).toEqual({
      format: 'jpeg',
      data: 'aGVsbG8=',
    });
  });

  it('PNG の dataURL を形式と base64 本体に分解する', () => {
    expect(splitDataUrl('data:image/png;base64,cG5n')).toEqual({
      format: 'png',
      data: 'cG5n',
    });
  });

  it('対応していない形式（WebP 等）は null を返す', () => {
    expect(splitDataUrl('data:image/webp;base64,d2VicA==')).toBeNull();
  });

  it('dataURL でない文字列や本体が空のものは null を返す', () => {
    expect(splitDataUrl('こんばんは')).toBeNull();
    expect(splitDataUrl('data:image/jpeg;base64,')).toBeNull();
  });
});

describe('MAX_CHAT_IMAGES', () => {
  it('エージェント側の上限（3枚）と揃っている', () => {
    expect(MAX_CHAT_IMAGES).toBe(3);
  });
});
