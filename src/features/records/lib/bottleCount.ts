import type { DrinkingStatus } from '@/types/schema';

/**
 * まとめ買いした購入記録を1本ずつ飲みきるための計算（Issue #159）。
 *
 * 購入記録は「本数（quantity）」と「まだ飲みきっていない本数（remainingQuantity）」を持つ。
 * ステータスは残っている本数のうち先頭の1本にかかると解釈する。
 * つまり本数3・残り3・飲み中なら「飲み中1本 + 未開封2本」。
 *
 * remainingQuantity を持たない記録（この機能より前に作ったもの）は、
 * 飲みきりなら0本、それ以外は quantity 本が残っているものとして扱う。
 */

/** 本数の計算に要る購入記録の項目だけを見る（UnifiedRecord をそのまま渡せる） */
export interface BottleStock {
  quantity?: number | null;
  remainingQuantity?: number | null;
  drinkingStatus?: DrinkingStatus | null;
}

/** 購入記録の本数。未設定・不正値は1本として扱う */
export function toBottleCount(quantity: number | null | undefined): number {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity)) return 1;
  const floored = Math.floor(quantity);
  return floored > 0 ? floored : 0;
}

/** 購入記録が持つステータス（未設定は未開封） */
function toStatus(record: BottleStock): DrinkingStatus {
  return record.drinkingStatus ?? 'NOT_STARTED';
}

/** まだ飲みきっていない本数 */
export function getRemainingBottles(record: BottleStock): number {
  if (toStatus(record) === 'FINISHED') return 0;

  const quantity = toBottleCount(record.quantity);
  const remaining = record.remainingQuantity;
  if (typeof remaining !== 'number' || !Number.isFinite(remaining)) return quantity;

  // 購入本数を減らす編集などで残本数が追い越すことがあるので、範囲に収める
  return Math.min(Math.max(Math.floor(remaining), 0), quantity);
}

/** 1件の購入記録が在庫に持つ本数の内訳 */
export interface BottleBreakdown {
  /** 未開封 + 飲み中 */
  total: number;
  notStarted: number;
  /** 開封して飲んでいる本数（0 か 1） */
  inProgress: number;
}

/**
 * 購入記録の在庫内訳を出す。
 * 開封できるのは一度に1本までとし、残りは未開封として数える。
 */
export function getBottleBreakdown(record: BottleStock): BottleBreakdown {
  const total = getRemainingBottles(record);
  const inProgress = toStatus(record) === 'IN_PROGRESS' ? Math.min(1, total) : 0;
  return { total, notStarted: total - inProgress, inProgress };
}

/** ステータス操作で購入記録に書き込む値 */
export interface DrinkingStatusUpdate {
  drinkingStatus: DrinkingStatus;
  remainingQuantity: number;
  /** undefined は「変更しない」（最後の1本を飲みきったときは開封日時を残す） */
  openedAt?: string | null;
}

export interface PlanStatusChangeOptions {
  /** 飲みきる本数（FINISHED へ進めるときだけ使う）。既定は1本 */
  bottles?: number;
  /** 開封日時に入れる現在時刻（ISO8601） */
  now: string;
}

/**
 * ステータス操作の結果を組み立てる。
 *
 * - 未開封 → 飲み中: 1本開ける。残本数は変わらない
 * - 飲み中 → 飲みきり: 指定本数を減らす。まだ残っていれば未開封へ戻し、
 *   0本になったときにはじめて記録全体が飲みきりになる
 * - 飲みきり → 未開封: 購入本数まで戻す（数え間違いのやり直し）
 */
export function planStatusChange(
  record: BottleStock,
  nextStatus: DrinkingStatus,
  options: PlanStatusChangeOptions,
): DrinkingStatusUpdate {
  const remaining = getRemainingBottles(record);

  if (nextStatus === 'IN_PROGRESS') {
    // 残本数0の記録は開けられないので、1本だけ戻して開封する
    return {
      drinkingStatus: 'IN_PROGRESS',
      remainingQuantity: Math.max(remaining, 1),
      openedAt: options.now,
    };
  }

  if (nextStatus === 'NOT_STARTED') {
    return {
      drinkingStatus: 'NOT_STARTED',
      remainingQuantity: toBottleCount(record.quantity),
      openedAt: null,
    };
  }

  const bottles = clampFinishedBottles(options.bottles ?? 1, remaining);
  const rest = Math.max(remaining - bottles, 0);
  if (rest > 0) {
    // まだ在庫があるので、記録としては未開封に戻す（開けている瓶は無い）
    return { drinkingStatus: 'NOT_STARTED', remainingQuantity: rest, openedAt: null };
  }
  return { drinkingStatus: 'FINISHED', remainingQuantity: 0 };
}

/** 飲みきる本数を 1〜残本数 に収める */
function clampFinishedBottles(bottles: number, remaining: number): number {
  const max = Math.max(remaining, 1);
  if (!Number.isFinite(bottles)) return 1;
  return Math.min(Math.max(Math.floor(bottles), 1), max);
}

/**
 * 購入本数を編集したときの残本数。
 *
 * 飲んだ本数（購入本数 - 残本数）を保ったまま、新しい購入本数に合わせる。
 * 3本のうち1本飲んだ記録を5本へ直したら、残りは4本になる。
 */
export function remainingAfterQuantityChange(record: BottleStock, nextQuantity: number): number {
  const quantity = toBottleCount(record.quantity);
  const consumed = Math.max(quantity - getRemainingBottles(record), 0);
  return Math.max(toBottleCount(nextQuantity) - consumed, 0);
}
