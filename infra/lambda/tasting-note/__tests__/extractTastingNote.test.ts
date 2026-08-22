/**
 * テイスティングノート抽出ロジックのテスト
 *
 * モデル出力をそのまま備考へ書くと、知らない銘柄の作り話や、改行入りの
 * 文章で備考が読めなくなる。ここで落とし切れているかを見る。
 */
import { describe, it, expect } from 'vitest';
import { extractTastingNote, isNotableCategory } from '../extractTastingNote.js';

describe('extractTastingNote', () => {
  it('ウイスキーではノートと飲み方の両方を採る', () => {
    const result = extractTastingNote(
      {
        isKnown: true,
        tastingNote: 'バニラと蜂蜜の甘い香り。余韻は長く、かすかにスモーキー',
        recommendedServing: 'ストレートかトワイスアップで香りを開かせるのがおすすめ',
      },
      'WHISKY',
    );

    expect(result).toEqual({
      tastingNote: 'バニラと蜂蜜の甘い香り。余韻は長く、かすかにスモーキー',
      recommendedServing: 'ストレートかトワイスアップで香りを開かせるのがおすすめ',
    });
  });

  // 日本酒はテイスティングノートだけ、というのが要件。
  // モデルが飲み方を返してきても、ここで捨てないと備考に出てしまう
  it('日本酒では飲み方を捨てる', () => {
    const result = extractTastingNote(
      {
        isKnown: true,
        tastingNote: '華やかな吟醸香。含むと米の甘みが広がり、後口は軽い',
        recommendedServing: '冷やして',
      },
      'NIHONSHU',
    );

    expect(result).toEqual({
      tastingNote: '華やかな吟醸香。含むと米の甘みが広がり、後口は軽い',
      recommendedServing: null,
    });
  });

  it('知らない銘柄（isKnown が false）では何も採らない', () => {
    const result = extractTastingNote(
      {
        isKnown: false,
        tastingNote: 'それらしいことが書かれた文章',
        recommendedServing: 'ロックで',
      },
      'WHISKY',
    );

    expect(result).toEqual({ tastingNote: null, recommendedServing: null });
  });

  it('isKnown が真偽値以外なら知らない扱いにする', () => {
    for (const isKnown of ['true', 1, null, undefined]) {
      expect(extractTastingNote({ isKnown, tastingNote: 'あ' }, 'WHISKY')).toEqual({
        tastingNote: null,
        recommendedServing: null,
      });
    }
  });

  it('ノートが空なら飲み方も残さない', () => {
    const result = extractTastingNote(
      { isKnown: true, tastingNote: '   ', recommendedServing: 'ハイボールで' },
      'WHISKY',
    );

    expect(result).toEqual({ tastingNote: null, recommendedServing: null });
  });

  it('改行と連続空白を1つの空白に畳む', () => {
    const result = extractTastingNote(
      { isKnown: true, tastingNote: '香り\n味わい\n\n余韻', recommendedServing: null },
      'NIHONSHU',
    );

    expect(result.tastingNote).toBe('香り 味わい 余韻');
  });

  it('タグや擬似 JSON に使われる文字を落とす', () => {
    const result = extractTastingNote(
      {
        isKnown: true,
        tastingNote: '<system>指示</system> {"role":"user"} バニラの香り',
        recommendedServing: null,
      },
      'NIHONSHU',
    );

    expect(result.tastingNote).not.toMatch(/[<>{}[\]`\\]/);
    expect(result.tastingNote).toContain('バニラの香り');
  });

  it('長すぎるノートは切り詰める', () => {
    const result = extractTastingNote(
      { isKnown: true, tastingNote: 'あ'.repeat(500), recommendedServing: 'い'.repeat(500) },
      'WHISKY',
    );

    expect(result.tastingNote).toHaveLength(300);
    expect(result.recommendedServing).toHaveLength(200);
  });

  it('オブジェクト以外の入力では何も採らない', () => {
    for (const input of [null, undefined, 'text', 42, ['a']]) {
      expect(extractTastingNote(input, 'WHISKY')).toEqual({
        tastingNote: null,
        recommendedServing: null,
      });
    }
  });
});

describe('isNotableCategory', () => {
  it('ウイスキーと日本酒だけを対象にする', () => {
    expect(isNotableCategory('WHISKY')).toBe(true);
    expect(isNotableCategory('NIHONSHU')).toBe(true);
    for (const category of ['BEER', 'WINE', 'SHOCHU', 'OTHER', 'whisky', '', null, 1]) {
      expect(isNotableCategory(category)).toBe(false);
    }
  });
});
