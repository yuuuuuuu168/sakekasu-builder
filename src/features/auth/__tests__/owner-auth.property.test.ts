// Feature: cdk-backend-auth, Property 3: owner ベース認可 round-trip
// **Validates: Requirements 3.6, 7.2, 7.3**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { SakeCategory } from '@/features/purchase/types';
import { SAKE_CATEGORIES } from '@/features/purchase/types';

// ============================================================
// 型定義
// ============================================================

/** 認証ユーザーのコンテキスト（AppSync $ctx.identity を模倣） */
interface AuthIdentity {
  sub: string; // Cognito ユーザーID
}

/** DynamoDB に保存されるレコード */
interface StoredRecord {
  id: string;
  owner: string;
  sakeName: string;
  storeName: string;
  price: number;
  purchaseDate: string;
  category: SakeCategory;
  memo?: string;
  createdAt: string;
  updatedAt: string;
}

/** create ミューテーションの入力 */
interface CreateRecordInput {
  sakeName: string;
  storeName: string;
  price: number;
  purchaseDate: string;
  category: SakeCategory;
  memo?: string;
}

// ============================================================
// モックリゾルバー（AppSync VTL リゾルバーのロジックを模倣）
// ============================================================

/**
 * インメモリ DynamoDB テーブル + owner-index GSI を模倣するストア
 */
class MockDynamoDBStore {
  private records: Map<string, StoredRecord> = new Map();
  private nextId = 1;

  /**
   * create リゾルバー: $ctx.identity.sub を owner に自動設定
   * Requirements 3.6, 7.2 に対応
   */
  createRecord(identity: AuthIdentity, input: CreateRecordInput): StoredRecord {
    const now = new Date().toISOString();
    const record: StoredRecord = {
      id: `record-${this.nextId++}`,
      owner: identity.sub, // リゾルバーが自動設定
      sakeName: input.sakeName,
      storeName: input.storeName,
      price: input.price,
      purchaseDate: input.purchaseDate,
      category: input.category,
      memo: input.memo,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.id, record);
    return record;
  }

  /**
   * list リゾルバー: owner-index GSI で owner = $ctx.identity.sub フィルタ
   * Requirements 7.3 に対応
   */
  listRecords(identity: AuthIdentity): StoredRecord[] {
    return Array.from(this.records.values()).filter(
      (record) => record.owner === identity.sub,
    );
  }

  /** ストアをリセット */
  clear(): void {
    this.records.clear();
    this.nextId = 1;
  }
}

// ============================================================
// fast-check ジェネレーター
// ============================================================

/** Cognito ユーザーID（UUID 形式）を生成 */
const userIdArb = fc.uuid();

/** 互いに異なる2つのユーザーIDを生成 */
const distinctUserPairArb = fc
  .tuple(userIdArb, userIdArb)
  .filter(([a, b]) => a !== b);

/** SakeCategory を生成 */
const sakeCategoryArb = fc.constantFrom(...SAKE_CATEGORIES);

/** YYYY-MM-DD 形式の日付を生成（無効な日付を避けるため整数ベースで構築） */
const dateStringArb = fc
  .tuple(
    fc.integer({ min: 2020, max: 2030 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

/** CreateRecordInput を生成 */
const createRecordInputArb: fc.Arbitrary<CreateRecordInput> = fc.record({
  sakeName: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  storeName: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  price: fc.integer({ min: 0, max: 100000 }),
  purchaseDate: dateStringArb,
  category: sakeCategoryArb,
  memo: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
});

/** 1〜5件のレコード入力リストを生成 */
const recordInputsArb = fc.array(createRecordInputArb, { minLength: 1, maxLength: 5 });

// ============================================================
// プロパティテスト
// ============================================================

describe('Property 3: owner ベース認可 round-trip', () => {
  it('ユーザー A が作成したレコードはユーザー A の list で返却され、ユーザー B の list では返却されない', () => {
    fc.assert(
      fc.property(
        distinctUserPairArb,
        recordInputsArb,
        ([userIdA, userIdB], inputs) => {
          const store = new MockDynamoDBStore();
          const identityA: AuthIdentity = { sub: userIdA };
          const identityB: AuthIdentity = { sub: userIdB };

          // ユーザー A がレコードを作成
          const createdRecords = inputs.map((input) =>
            store.createRecord(identityA, input),
          );

          // ユーザー A の list クエリ → 全レコードが返却される
          const listA = store.listRecords(identityA);
          expect(listA).toHaveLength(createdRecords.length);

          // 作成した全レコードが list に含まれる
          const listAIds = new Set(listA.map((r) => r.id));
          for (const record of createdRecords) {
            expect(listAIds.has(record.id)).toBe(true);
          }

          // ユーザー B の list クエリ → 空（ユーザー A のレコードは返却されない）
          const listB = store.listRecords(identityB);
          expect(listB).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('作成されたレコードの owner フィールドにはユーザー A の ID が自動設定される', () => {
    fc.assert(
      fc.property(
        userIdArb,
        createRecordInputArb,
        (userId, input) => {
          const store = new MockDynamoDBStore();
          const identity: AuthIdentity = { sub: userId };

          // レコード作成
          const record = store.createRecord(identity, input);

          // owner がユーザーの sub と一致する
          expect(record.owner).toBe(userId);

          // 入力データが正しく保存されている
          expect(record.sakeName).toBe(input.sakeName);
          expect(record.storeName).toBe(input.storeName);
          expect(record.price).toBe(input.price);
          expect(record.purchaseDate).toBe(input.purchaseDate);
          expect(record.category).toBe(input.category);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('複数ユーザーが混在する場合、各ユーザーは自身のレコードのみ取得できる', () => {
    fc.assert(
      fc.property(
        distinctUserPairArb,
        recordInputsArb,
        recordInputsArb,
        ([userIdA, userIdB], inputsA, inputsB) => {
          const store = new MockDynamoDBStore();
          const identityA: AuthIdentity = { sub: userIdA };
          const identityB: AuthIdentity = { sub: userIdB };

          // ユーザー A と B がそれぞれレコードを作成
          const recordsA = inputsA.map((input) =>
            store.createRecord(identityA, input),
          );
          const recordsB = inputsB.map((input) =>
            store.createRecord(identityB, input),
          );

          // ユーザー A の list → A のレコードのみ
          const listA = store.listRecords(identityA);
          expect(listA).toHaveLength(recordsA.length);
          for (const record of listA) {
            expect(record.owner).toBe(userIdA);
          }

          // ユーザー B の list → B のレコードのみ
          const listB = store.listRecords(identityB);
          expect(listB).toHaveLength(recordsB.length);
          for (const record of listB) {
            expect(record.owner).toBe(userIdB);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
