# Implementation Plan: 購入・飲酒記録の一覧ページ

## Overview

`src/features/records/` に記録一覧機能を構築する。型定義・純粋関数（フィルタ・ソート）から着手し、データ取得フック、UIコンポーネントの順に実装する。各ステップでプロパティベーステストとユニットテストを組み込み、最後にページコンポーネントで全体を統合する。

## Tasks

- [x] 1. 型定義とユーティリティの作成
  - [x] 1.1 `src/features/records/types.ts` を作成する
    - `UnifiedRecord`, `RecordType`, `RecordTypeFilter`, `CategoryFilter`, `SortOption` 型を定義
    - `SORT_OPTIONS`, `RECORD_TYPE_OPTIONS`, `CATEGORY_FILTER_OPTIONS` 定数を定義
    - 既存の `SakeCategory` を `src/features/purchase/types` からインポート
    - _Requirements: 1.2, 1.3, 2.1, 3.1, 4.1_

- [x] 2. フィルタリングロジックの実装
  - [x] 2.1 `src/features/records/hooks/useRecordFilter.ts` に `filterRecords` 純粋関数を実装する
    - RecordTypeFilter による記録種別フィルタリング（all / purchase / drinking）
    - CategoryFilter によるカテゴリフィルタリング（all / 各カテゴリ）
    - 両フィルタのAND条件での組み合わせ
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4_

  - [x] 2.2 `src/features/records/__tests__/filter.property.test.ts` にプロパティテストを作成する
    - **Property 1: 記録種別フィルタの正確性**
    - **Validates: Requirements 2.2, 2.3, 2.4**

  - [x] 2.3 `src/features/records/__tests__/filter.property.test.ts` にプロパティテストを追加する
    - **Property 2: カテゴリフィルタの正確性**
    - **Validates: Requirements 3.2, 3.3**

  - [x] 2.4 `src/features/records/__tests__/filter.property.test.ts` にプロパティテストを追加する
    - **Property 3: フィルタの合成（AND条件）**
    - **Validates: Requirements 3.4**

  - [x] 2.5 `src/features/records/__tests__/filter.property.test.ts` にプロパティテストを追加する
    - **Property 6: フィルタはレコードを追加しない（メタモルフィック）**
    - **Validates: Requirements 2.2, 2.3, 2.4, 3.2, 3.3**

- [x] 3. ソートロジックの実装
  - [x] 3.1 `src/features/records/hooks/useRecordSort.ts` に `sortRecords` 純粋関数を実装する
    - 日付ソート（新しい順 / 古い順）: purchaseDate or drinkingDate を `date` フィールドで統一
    - 価格ソート（高い順 / 低い順）: price が null の要素は末尾に配置
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 3.2 `src/features/records/__tests__/sort.property.test.ts` にプロパティテストを作成する
    - **Property 4: 日付ソートの整列性**
    - **Validates: Requirements 4.2, 4.3**

  - [x] 3.3 `src/features/records/__tests__/sort.property.test.ts` にプロパティテストを追加する
    - **Property 5: 価格ソートの整列性（null末尾保証）**
    - **Validates: Requirements 4.4, 4.5**

  - [x] 3.4 `src/features/records/__tests__/sort.property.test.ts` にプロパティテストを追加する
    - **Property 7: ソートは要素を保存する（不変量）**
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.5**

- [x] 4. Checkpoint - フィルタ・ソートロジックの確認
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. データ取得フックの実装
  - [x] 5.1 `src/features/records/hooks/useRecordFetch.ts` を実装する
    - Amplify Data API で PurchaseRecord と DrinkingRecord を並行取得
    - `toPurchaseUnifiedRecord` / `toDrinkingUnifiedRecord` 変換関数を実装
    - ローディング状態、エラー状態、refetch 関数を提供
    - 部分的エラー時は取得できたデータのみ返却
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 5.2 `src/features/records/hooks/useRecordList.ts` を実装する
    - `useRecordFetch`, `filterRecords`, `sortRecords` を統合
    - フィルタ・ソートの状態管理（useState）
    - 初期状態: recordType='all', category='all', sortOption='date-desc'
    - _Requirements: 1.1, 2.5, 4.6_

- [x] 6. UIコンポーネントの実装
  - [x] 6.1 `src/features/records/components/EmptyState.tsx`, `LoadingState.tsx`, `ErrorState.tsx` を作成する
    - EmptyState: フィルタ有無で「記録がありません」/「条件に一致する記録がありません」を切り替え
    - LoadingState: スケルトンUIまたはスピナー表示
    - ErrorState: エラーメッセージ + 再取得ボタン
    - _Requirements: 1.5, 3.5, 5.2, 5.3_

  - [x] 6.2 `src/features/records/components/RecordCard.tsx` を実装する
    - 購入記録: 銘柄名、購入店舗、価格、購入日、カテゴリ表示
    - 飲酒記録: 銘柄名、飲んだ場所、価格、飲んだ日、カテゴリ、飲み方、評価表示
    - 記録種別ラベル（購入 / 飲酒）を視覚的に区別
    - モバイル・デスクトップ対応のレスポンシブレイアウト
    - _Requirements: 1.2, 1.3, 1.4, 6.1, 6.2_

  - [x] 6.3 `src/features/records/__tests__/RecordCard.property.test.tsx` にプロパティテストを作成する
    - **Property 8: RecordCard の必須フィールド表示**
    - **Validates: Requirements 1.2, 1.3, 1.4**

  - [x] 6.4 `src/features/records/components/FilterControls.tsx` を実装する
    - 記録種別フィルタ（すべて / 購入記録 / 飲酒記録）
    - カテゴリフィルタ（すべて / 日本酒 / ビール / ワイン / ウイスキー / 焼酎 / その他）
    - モバイルでも操作可能なサイズ
    - _Requirements: 2.1, 2.5, 3.1, 6.3_

  - [x] 6.5 `src/features/records/components/SortControl.tsx` を実装する
    - 4つの並び替えオプション（日付新しい順/古い順、価格高い順/低い順）
    - 初期状態で「日付（新しい順）」を選択済み
    - _Requirements: 4.1, 4.6_

  - [x] 6.6 `src/features/records/__tests__/RecordCard.test.tsx` にユニットテストを作成する
    - 購入記録・飲酒記録の具体的な表示例をテスト
    - _Requirements: 1.2, 1.3, 1.4_

- [x] 7. Checkpoint - UIコンポーネントの確認
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. ページ統合とルーティング
  - [x] 8.1 `src/features/records/components/RecordListPage.tsx` を実装する
    - `useRecordList` フックで全状態を管理
    - FilterControls, SortControl, RecordCard, EmptyState, LoadingState, ErrorState を組み合わせ
    - レスポンシブレイアウト（モバイル: カード型リスト、デスクトップ: 情報量の多いレイアウト）
    - _Requirements: 1.1, 1.5, 3.5, 6.1, 6.2_

  - [x] 8.2 ルーティングに RecordListPage を追加する
    - App.tsx または既存のルーティング設定に `/records` パスを追加
    - ナビゲーションにリンクを追加
    - _Requirements: 1.1_

  - [x] 8.3 `src/features/records/__tests__/RecordListPage.test.tsx` にユニットテストを作成する
    - 空状態メッセージ、ローディング表示、エラー表示+再取得ボタンのテスト
    - _Requirements: 1.5, 5.2, 5.3_

- [x] 9. Final checkpoint - 全体の確認
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- 各タスクは設計ドキュメントの型定義・インターフェースに従って実装する
- フィルタ・ソートは純粋関数として実装し、プロパティベーステストで正しさを検証する
- Amplify Data API のモックは `src/__mocks__/` の既存パターンに従う
- shadcn/ui コンポーネントをベースにUIを構築し、和モダンテーマに合わせる
