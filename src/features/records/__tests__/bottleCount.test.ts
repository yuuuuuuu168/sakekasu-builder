import { describe, it, expect } from 'vitest';
import {
  getBottleBreakdown,
  getRemainingBottles,
  planStatusChange,
  remainingAfterQuantityChange,
  toBottleCount,
} from '../lib/bottleCount';
import type { BottleStock } from '../lib/bottleCount';

const NOW = '2026-08-22T10:00:00.000Z';

describe('getRemainingBottles', () => {
  it('残本数を持つ記録はその本数を返す', () => {
    expect(getRemainingBottles({ quantity: 3, remainingQuantity: 2, drinkingStatus: 'NOT_STARTED' })).toBe(2);
  });

  it('残本数を持たない記録は購入本数を残りとみなす', () => {
    expect(getRemainingBottles({ quantity: 3, drinkingStatus: 'IN_PROGRESS' })).toBe(3);
  });

  it('残本数も購入本数も無ければ1本', () => {
    expect(getRemainingBottles({})).toBe(1);
  });

  // 残本数を持たない飲みきり済みの記録を購入本数で補完すると、在庫に復活してしまう
  it('飲みきりの記録は残本数を持っていなくても0本', () => {
    expect(getRemainingBottles({ quantity: 3, drinkingStatus: 'FINISHED' })).toBe(0);
  });

  it('購入本数を超える残本数は購入本数まで切り詰める', () => {
    expect(getRemainingBottles({ quantity: 2, remainingQuantity: 5, drinkingStatus: 'NOT_STARTED' })).toBe(2);
  });
});

describe('getBottleBreakdown', () => {
  it('飲み中でも開封しているのは1本だけで、残りは未開封', () => {
    const breakdown = getBottleBreakdown({ quantity: 3, remainingQuantity: 3, drinkingStatus: 'IN_PROGRESS' });
    expect(breakdown).toEqual({ total: 3, notStarted: 2, inProgress: 1 });
  });

  it('未開封の記録は残りぜんぶが未開封', () => {
    expect(getBottleBreakdown({ quantity: 3, remainingQuantity: 2, drinkingStatus: 'NOT_STARTED' })).toEqual({
      total: 2,
      notStarted: 2,
      inProgress: 0,
    });
  });

  it('飲みきりの記録は在庫0本', () => {
    expect(getBottleBreakdown({ quantity: 3, remainingQuantity: 0, drinkingStatus: 'FINISHED' })).toEqual({
      total: 0,
      notStarted: 0,
      inProgress: 0,
    });
  });
});

describe('planStatusChange', () => {
  const threeBottles: BottleStock = { quantity: 3, remainingQuantity: 3, drinkingStatus: 'IN_PROGRESS' };

  it('1本飲みきっても残りがあれば未開封へ戻し、記録は飲みきりにしない', () => {
    expect(planStatusChange(threeBottles, 'FINISHED', { now: NOW })).toEqual({
      drinkingStatus: 'NOT_STARTED',
      remainingQuantity: 2,
      openedAt: null,
    });
  });

  it('まとめて飲みきった本数ぶんだけ減らす', () => {
    expect(planStatusChange(threeBottles, 'FINISHED', { bottles: 2, now: NOW })).toEqual({
      drinkingStatus: 'NOT_STARTED',
      remainingQuantity: 1,
      openedAt: null,
    });
  });

  it('最後の1本を飲みきったときだけ記録が飲みきりになる', () => {
    const lastOne: BottleStock = { quantity: 3, remainingQuantity: 1, drinkingStatus: 'IN_PROGRESS' };
    const update = planStatusChange(lastOne, 'FINISHED', { now: NOW });
    expect(update.drinkingStatus).toBe('FINISHED');
    expect(update.remainingQuantity).toBe(0);
    // 飲みきりでは開封日時を残す（いつ開けた瓶かが分からなくなるため）
    expect(update.openedAt).toBeUndefined();
  });

  it('残本数より多い本数を指定しても残り以上には減らない', () => {
    expect(planStatusChange(threeBottles, 'FINISHED', { bottles: 99, now: NOW })).toEqual({
      drinkingStatus: 'FINISHED',
      remainingQuantity: 0,
    });
  });

  it('残本数を持たない1本の記録はこれまでどおり飲みきりになる', () => {
    expect(planStatusChange({ quantity: 1, drinkingStatus: 'IN_PROGRESS' }, 'FINISHED', { now: NOW })).toEqual({
      drinkingStatus: 'FINISHED',
      remainingQuantity: 0,
    });
  });

  it('開封しても残本数は減らず、開封日時が入る', () => {
    expect(
      planStatusChange({ quantity: 3, remainingQuantity: 3, drinkingStatus: 'NOT_STARTED' }, 'IN_PROGRESS', {
        now: NOW,
      }),
    ).toEqual({ drinkingStatus: 'IN_PROGRESS', remainingQuantity: 3, openedAt: NOW });
  });

  it('飲みきりから未開封へ戻すと購入本数まで在庫が戻る', () => {
    expect(
      planStatusChange({ quantity: 3, remainingQuantity: 0, drinkingStatus: 'FINISHED' }, 'NOT_STARTED', {
        now: NOW,
      }),
    ).toEqual({ drinkingStatus: 'NOT_STARTED', remainingQuantity: 3, openedAt: null });
  });

  it('飲みきりの記録を開封すると1本ぶんだけ在庫が戻る', () => {
    expect(
      planStatusChange({ quantity: 3, remainingQuantity: 0, drinkingStatus: 'FINISHED' }, 'IN_PROGRESS', {
        now: NOW,
      }),
    ).toEqual({ drinkingStatus: 'IN_PROGRESS', remainingQuantity: 1, openedAt: NOW });
  });
});

describe('remainingAfterQuantityChange', () => {
  it('飲んだ本数を保ったまま新しい購入本数に合わせる', () => {
    const record: BottleStock = { quantity: 3, remainingQuantity: 2, drinkingStatus: 'NOT_STARTED' };
    expect(remainingAfterQuantityChange(record, 5)).toBe(4);
  });

  it('飲んだ本数より少なく直したら残りは0本', () => {
    const record: BottleStock = { quantity: 3, remainingQuantity: 1, drinkingStatus: 'NOT_STARTED' };
    expect(remainingAfterQuantityChange(record, 1)).toBe(0);
  });

  it('1本も飲んでいなければ新しい購入本数がそのまま残る', () => {
    expect(remainingAfterQuantityChange({ quantity: 2, remainingQuantity: 2 }, 4)).toBe(4);
  });
});

describe('toBottleCount', () => {
  it('未設定・不正値は1本として数える', () => {
    expect(toBottleCount(undefined)).toBe(1);
    expect(toBottleCount(null)).toBe(1);
    expect(toBottleCount(Number.NaN)).toBe(1);
  });

  it('小数は切り捨て、0以下は0本', () => {
    expect(toBottleCount(2.7)).toBe(2);
    expect(toBottleCount(-1)).toBe(0);
  });
});
