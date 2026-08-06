import { describe, it, expect } from 'vitest';
import { normalizeText, toPhoneticKey } from '../lib/searchNormalize';

describe('見た目の正規化', () => {
  it('ひらがなとカタカナを同じ扱いにする', () => {
    expect(normalizeText('あらん')).toBe(normalizeText('アラン'));
  });

  it('半角カナを全角カナと同じ扱いにする', () => {
    expect(normalizeText('ｱﾗﾝ')).toBe(normalizeText('アラン'));
  });

  it('濁点付きの半角カナも揃う', () => {
    expect(normalizeText('ﾎﾞｳﾓｱ')).toBe(normalizeText('ボウモア'));
  });

  it('全角英数と半角英数、大文字小文字を同じ扱いにする', () => {
    expect(normalizeText('ＡＲＲＡＮ')).toBe(normalizeText('arran'));
  });

  it('前後の空白は落とす', () => {
    expect(normalizeText('  アラン  ')).toBe('アラン');
  });
});

describe('音のキー', () => {
  // 人間様から挙がった実例
  it('アラン・あらん・Allan・Arran がすべて同じキーになる', () => {
    const keys = ['アラン', 'あらん', 'ｱﾗﾝ', 'Allan', 'Arran', 'ＡＲＲＡＮ'].map(toPhoneticKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('カタカナと英字表記が結びつく（ヤマザキ / Yamazaki）', () => {
    expect(toPhoneticKey('ヤマザキ')).toBe(toPhoneticKey('Yamazaki'));
  });

  it('促音を含む語も結びつく（マッカラン / Macallan）', () => {
    expect(toPhoneticKey('マッカラン')).toBe(toPhoneticKey('Macallan'));
  });

  it('拗音をローマ字に変換できる', () => {
    expect(toPhoneticKey('シャリ')).toBe('shari');
    expect(toPhoneticKey('ジョン')).toBe('jon');
  });

  it('長音記号は無視する（ビール / ビル）', () => {
    expect(toPhoneticKey('ビール')).toBe(toPhoneticKey('ビル'));
  });

  it('l と r を書き分けない', () => {
    expect(toPhoneticKey('lager')).toBe(toPhoneticKey('rager'));
  });

  it('v と b を書き分けない（ヴォッカ / ボッカ）', () => {
    expect(toPhoneticKey('ヴォッカ')).toBe(toPhoneticKey('ボッカ'));
  });

  // 別の銘柄まで同じキーになると検索が使い物にならない
  it('別の語は別のキーになる', () => {
    const pairs: [string, string][] = [
      ['アラン', 'キリン'],
      ['ヤマザキ', 'ヤマト'],
      ['ハクシュウ', 'ハクタカ'],
      ['カク', 'コク'],
      ['アサヒ', 'アシ'],
    ];
    for (const [a, b] of pairs) {
      expect(toPhoneticKey(a), `${a} と ${b} が同じキーになっている`).not.toBe(
        toPhoneticKey(b),
      );
    }
  });

  it('空文字を渡しても壊れない', () => {
    expect(toPhoneticKey('')).toBe('');
    expect(toPhoneticKey('   ')).toBe('');
  });

  it('漢字はそのまま残す（読みには変換しない）', () => {
    expect(toPhoneticKey('獺祭')).toBe('獺祭');
  });
});
