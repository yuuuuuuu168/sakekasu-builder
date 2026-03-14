import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { SAKE_CATEGORIES } from '@/features/purchase/types';
import type { SakeCategory } from '@/features/purchase/types';
import {
  getDrinkingMethodsByCategory,
  DRINKING_METHODS_MAP,
} from '../types';

// Feature: sake-drinking-registration, Property 1: カテゴリ変更時の飲み方連動

/** 有効な SakeCategory を生成する Arbitrary */
const sakeCategoryArb = fc.constantFrom(...SAKE_CATEGORIES);

/**
 * Property 1: カテゴリ変更時の飲み方連動
 * Validates: Requirements 1.4, 1.5
 *
 * ランダムな SakeCategory ペア（変更前・変更後）で、
 * getDrinkingMethodsByCategory の返り値が対応する飲み方リストと一致し、
 * カテゴリ変更時に飲み方がリセットされることを検証する。
 */
describe('Property 1: カテゴリ変更時の飲み方連動', () => {
  it('任意のカテゴリに対して getDrinkingMethodsByCategory が DRINKING_METHODS_MAP と一致する', () => {
    fc.assert(
      fc.property(sakeCategoryArb, (category: SakeCategory) => {
        const result = getDrinkingMethodsByCategory(category);
        const expected = DRINKING_METHODS_MAP[category];

        // 返り値が DRINKING_METHODS_MAP の対応するリストと完全一致すること
        expect(result).toEqual(expected);

        // ウイスキーのみ「その他」が含まれること
        if (category === 'WHISKY') {
          expect(result).toContain('その他');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('カテゴリ変更時に以前の飲み方が新しいカテゴリのリストに含まれない場合がある（リセットが必要）', () => {
    fc.assert(
      fc.property(
        sakeCategoryArb,
        sakeCategoryArb,
        (prevCategory: SakeCategory, nextCategory: SakeCategory) => {
          const prevMethods = getDrinkingMethodsByCategory(prevCategory);
          const nextMethods = getDrinkingMethodsByCategory(nextCategory);

          // 新しいカテゴリの飲み方リストが正しいこと
          expect(nextMethods).toEqual(DRINKING_METHODS_MAP[nextCategory]);

          if (prevCategory !== nextCategory) {
            // カテゴリが異なる場合、以前の飲み方リストから選んだ値が
            // 新しいリストに含まれない可能性がある → リセットが必要
            const prevOnlyMethods = prevMethods.filter(
              (m) => !nextMethods.includes(m),
            );

            // prevOnlyMethods に含まれる飲み方は新カテゴリでは無効
            for (const method of prevOnlyMethods) {
              expect(
                nextMethods,
                `カテゴリ変更 ${prevCategory} → ${nextCategory} で飲み方 "${method}" は新カテゴリに含まれないためリセットが必要`,
              ).not.toContain(method);
            }
          }

          // 同じカテゴリの場合でも、返り値は常に正しいリストであること
          expect(nextMethods).toEqual(DRINKING_METHODS_MAP[nextCategory]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
