/**
 * 備考への追記ロジックのテスト。
 *
 * 何度登録・更新しても同じ行が積み上がらないこと、対象外のカテゴリには
 * 何も書かないことを見る。
 */
import { describe, it, expect } from 'vitest';
import {
  appendTastingNoteToMemo,
  hasTastingNote,
  supportsTastingNote,
} from '../lib/tastingNoteMemo';

describe('supportsTastingNote', () => {
  it('ウイスキーと日本酒だけを対象にする', () => {
    expect(supportsTastingNote('WHISKY')).toBe(true);
    expect(supportsTastingNote('NIHONSHU')).toBe(true);
  });

  it('ビール・ワイン・焼酎・その他には書かない', () => {
    for (const category of ['BEER', 'WINE', 'SHOCHU', 'OTHER'] as const) {
      expect(supportsTastingNote(category)).toBe(false);
    }
  });
});

describe('hasTastingNote', () => {
  it('行頭のラベルで記載済みと判定する', () => {
    expect(hasTastingNote('テイスティングノート: バニラの香り')).toBe(true);
    expect(hasTastingNote('近所の酒屋で購入\nテイスティングノート: バニラの香り')).toBe(true);
  });

  it('ラベルが無ければ未記載とする', () => {
    expect(hasTastingNote('')).toBe(false);
    expect(hasTastingNote(null)).toBe(false);
    expect(hasTastingNote(undefined)).toBe(false);
    expect(hasTastingNote('美味しかった')).toBe(false);
  });

  // 「おすすめの飲み方」だけが残っている備考は、ノート本体が無いので未記載
  it('飲み方の行だけでは記載済みにしない', () => {
    expect(hasTastingNote('おすすめの飲み方: ロックで')).toBe(false);
  });
});

describe('appendTastingNoteToMemo', () => {
  it('ノートと飲み方を1行ずつ足す', () => {
    const memo = appendTastingNoteToMemo('', {
      tastingNote: 'バニラと蜂蜜の香り',
      recommendedServing: 'ストレートで',
    });

    expect(memo).toBe('テイスティングノート: バニラと蜂蜜の香り\nおすすめの飲み方: ストレートで');
  });

  it('既存の備考を消さずに後ろへ足す', () => {
    const memo = appendTastingNoteToMemo('産地: 山口県', {
      tastingNote: '華やかな吟醸香',
      recommendedServing: null,
    });

    expect(memo).toBe('産地: 山口県\nテイスティングノート: 華やかな吟醸香');
  });

  // 登録 → 編集 → 再保存で同じ行が積み上がると、備考が読めなくなる
  it('すでにノートがあれば何も足さない', () => {
    const existing = 'テイスティングノート: 元の内容';
    const memo = appendTastingNoteToMemo(existing, {
      tastingNote: '新しい内容',
      recommendedServing: 'ロックで',
    });

    expect(memo).toBe(existing);
  });

  it('知らない銘柄（両方 null）では備考を変えない', () => {
    expect(
      appendTastingNoteToMemo('買った日: 昨日', { tastingNote: null, recommendedServing: null }),
    ).toBe('買った日: 昨日');
  });

  it('ノート抜きで飲み方だけは書かない', () => {
    expect(
      appendTastingNoteToMemo('', { tastingNote: null, recommendedServing: 'ロックで' }),
    ).toBe('');
  });
});
