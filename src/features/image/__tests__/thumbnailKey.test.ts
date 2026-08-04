import { describe, it, expect } from 'vitest';
import {
  toThumbnailKey,
  toThumbnailFileName,
  THUMBNAIL_PREFIX,
} from '../lib/thumbnailKey';

describe('toThumbnailKey', () => {
  it('ファイル名部分にだけプレフィックスを付ける', () => {
    expect(toThumbnailKey('user123/purchase/rec-001/label.jpg')).toBe(
      'user123/purchase/rec-001/thumb_label.jpg',
    );
  });

  it('ディレクトリ部分は変更しない（sub の前置検証を壊さない）', () => {
    const key = 'user123/drinking/rec-002/photo.png';
    const thumb = toThumbnailKey(key);
    expect(thumb.startsWith('user123/')).toBe(true);
    expect(thumb.split('/').length).toBe(key.split('/').length);
  });

  it('スラッシュを含まないキーでも先頭に付与する', () => {
    expect(toThumbnailKey('label.jpg')).toBe('thumb_label.jpg');
  });

  it('ファイル名にドットが複数あっても壊れない', () => {
    expect(toThumbnailKey('u/p/r/my.photo.v2.jpg')).toBe(
      'u/p/r/thumb_my.photo.v2.jpg',
    );
  });
});

describe('toThumbnailFileName', () => {
  it('ファイル名にプレフィックスを付ける', () => {
    expect(toThumbnailFileName('label.jpg')).toBe('thumb_label.jpg');
  });

  it('アップロード時の名前と表示時の導出キーが一致する', () => {
    const ownerPrefix = 'user123/purchase/rec-001/';
    const fileName = 'label.jpg';

    // アップロード側: fileName を変えて同じディレクトリに保存する
    const uploadedKey = `${ownerPrefix}${toThumbnailFileName(fileName)}`;
    // 表示側: 原画キーから導出する
    const derivedKey = toThumbnailKey(`${ownerPrefix}${fileName}`);

    expect(derivedKey).toBe(uploadedKey);
  });
});

describe('THUMBNAIL_PREFIX', () => {
  it('バックフィルスクリプトと同じ値である', () => {
    // infra/scripts/backfill-thumbnails.py の THUMBNAIL_PREFIX と揃える
    expect(THUMBNAIL_PREFIX).toBe('thumb_');
  });
});
