# Implementation Plan: 購入したお酒の登録

## Overview

AWS Amplify Gen 2のData機能でバックエンドを構築し、React + TypeScript + shadcn/ui + Framer MotionでフォームUIを実装する。バリデーションロジックをカスタムフックとして分離し、テスタビリティを確保する。各ステップは前のステップの成果物に依存し、最終的にすべてを統合する。

## Tasks

- [x] 1. Amplify Data スキーマとバックエンド設定
  - [x] 1.1 `amplify/data/resource.ts` に SakeCategory enum と PurchaseRecord モデルを定義する
    - SakeCategory: NIHONSHU, BEER, WINE, WHISKY, SHOCHU, OTHER
    - PurchaseRecord: sakeName, storeName, price(integer), purchaseDate(date), category(ref SakeCategory), memo(string optional)
    - publicApiKey 認証を設定する
    - _Requirements: 4.1_
  - [x] 1.2 `amplify/backend.ts` に data リソースを登録する
    - _Requirements: 4.1_

- [ ] 2. 共通UIセットアップとテーマ設定
  - [x] 2.1 Tailwind CSS v4 のカスタムテーマを設定する
    - 和モダンカラーパレット（藍色 `#1B365D`、金色 `#C5A572`、ダークモード用 `#1A1A2E`、`#D4AF37`）
    - Noto Sans JP + Inter フォント設定
    - _Requirements: 1.1_
  - [x] 2.2 ダークモード切替の ThemeProvider と ThemeToggle コンポーネントを作成する
    - Tailwind CSS の `dark:` バリアントを使用
    - システム設定連動 + 手動切替
    - _Requirements: 1.1_
  - [-] 2.3 必要な shadcn/ui コンポーネントを追加する（Input, Select, Button, Textarea, Popover, Calendar, Toast）
    - _Requirements: 1.1_

- [ ] 3. バリデーションロジックの実装
  - [~] 3.1 `src/features/purchase/hooks/useFormValidation.ts` を作成する
    - validateField: フィールド単位のバリデーション
    - validateAll: 全フィールド一括バリデーション
    - isValid: 全フィールドの有効性判定
    - clearErrors: エラーのクリア
    - バリデーションルール: 銘柄名・店舗名は空文字/空白のみ不可、価格は0以上の整数、購入日は本日以前、カテゴリは有効な列挙値
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [~] 3.2 Property 1 のプロパティテストを作成する（`validation.property.test.ts`）
    - **Property 1: 必須フィールド空欄バリデーション**
    - 必須フィールドのランダムな部分集合を空にした入力データでバリデーション失敗を検証
    - **Validates: Requirements 2.1**
  - [~] 3.3 Property 2 のプロパティテストを作成する（`validation.property.test.ts`）
    - **Property 2: 無効な価格入力バリデーション**
    - 非数値文字列・負の数値でバリデーション失敗とエラーメッセージを検証
    - **Validates: Requirements 2.2, 2.3**
  - [~] 3.4 Property 3 のプロパティテストを作成する（`validation.property.test.ts`）
    - **Property 3: 未来日付バリデーション**
    - 明日以降のランダムな日付でバリデーション失敗とエラーメッセージを検証
    - **Validates: Requirements 2.4**
  - [~] 3.5 Property 4 のプロパティテストを作成する（`validation.property.test.ts`）
    - **Property 4: 有効入力のバリデーション通過**
    - 全フィールドが有効なランダム入力データでバリデーション成功を検証
    - **Validates: Requirements 2.5**

- [ ] 4. Checkpoint - バリデーションロジックの確認
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. ストレージフックの実装
  - [~] 5.1 `src/features/purchase/hooks/usePurchaseStorage.ts` を作成する
    - Amplify Data Client を使用して PurchaseRecord の保存（create mutation）を実装
    - savePurchase: PurchaseFormData を受け取り SaveResult を返す
    - isSaving: 保存中の状態管理
    - エラーハンドリング: ネットワークエラー・APIエラーをキャッチし SaveResult.error に設定
    - _Requirements: 3.1, 3.4, 3.5, 4.1_
  - [~] 5.2 Property 7 のプロパティテストを作成する（`storage.property.test.ts`）
    - **Property 7: PurchaseRecord のラウンドトリップ**
    - ランダムな有効 PurchaseRecord を保存後に取得し、元データと同等であることを検証
    - Amplify Data Client をモックして検証
    - **Validates: Requirements 4.3**
  - [~] 5.3 Property 8 のプロパティテストを作成する（`storage.property.test.ts`）
    - **Property 8: 登録日時降順取得**
    - ランダムな複数 PurchaseRecord を保存後に取得し、createdAt の降順であることを検証
    - **Validates: Requirements 4.2**

- [ ] 6. 購入登録フォームUIの実装
  - [~] 6.1 `src/features/purchase/hooks/usePurchaseForm.ts` を作成する
    - フォーム状態管理（PurchaseFormData の初期値設定、購入日は当日）
    - useFormValidation と usePurchaseStorage を統合
    - handleSubmit: バリデーション → 保存 → 成功時リセット / 失敗時入力保持
    - _Requirements: 1.2, 3.1, 3.2, 3.3, 3.4, 3.5, 5.1_
  - [~] 6.2 `src/features/purchase/components/PurchaseForm.tsx` を作成する
    - shadcn/ui コンポーネントでフォームフィールドを構築
    - 銘柄名・店舗名: Input、価格: Input(type=number) + 円マーク接頭辞、購入日: Popover+Calendar、カテゴリ: Select、メモ: Textarea
    - バリデーションエラーをフィールド横に表示（onBlur 時）
    - 登録ボタンの有効/無効制御、送信中ローディングスピナー表示
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.5_
  - [~] 6.3 Framer Motion アニメーションを追加する
    - フォームカード: フェードイン + 下からスライド
    - 成功メッセージ: 右上からスライドイン → 3秒後フェードアウト（Toast）
    - エラーメッセージ: AnimatePresence でスライドダウン表示
    - 登録ボタン: ホバー時スケールアップ
    - _Requirements: 1.1_
  - [~] 6.4 Property 5 のプロパティテストを作成する（`PurchaseForm.property.test.tsx`）
    - **Property 5: 保存成功後のフォームリセット**
    - ランダムな有効入力データ + 保存成功モックでフォームリセットを検証
    - **Validates: Requirements 3.3, 5.1**
  - [~] 6.5 Property 6 のプロパティテストを作成する（`PurchaseForm.property.test.tsx`）
    - **Property 6: 保存失敗時の入力保持**
    - ランダムな有効入力データ + 保存失敗モックで入力値保持を検証
    - **Validates: Requirements 3.5**
  - [~] 6.6 Property 9 のプロパティテストを作成する（`PurchaseForm.property.test.tsx`）
    - **Property 9: 連続登録時の成功メッセージ表示**
    - ランダムな回数（2〜10）の有効入力データで各登録後に成功メッセージが表示されることを検証
    - **Validates: Requirements 5.2**

- [ ] 7. Checkpoint - フォームUIの確認
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. ページ統合とルーティング
  - [~] 8.1 `src/features/purchase/components/PurchaseRegistrationPage.tsx` を作成する
    - PurchaseForm を含むページコンポーネント
    - ページタイトル「🍶 購入したお酒を登録」とThemeToggle を配置
    - グラスモーフィズム風カードレイアウト（rounded-xl, shadow-lg, 半透明背景）
    - レスポンシブ対応（モバイルファースト）
    - _Requirements: 1.1_
  - [~] 8.2 `src/App.tsx` に PurchaseRegistrationPage を統合する
    - Amplify configure の設定
    - ThemeProvider でラップ
    - Toaster コンポーネントの配置
    - _Requirements: 1.1, 3.2_
  - [~] 8.3 PurchaseForm のユニットテストを作成する（`PurchaseForm.test.tsx`）
    - フォーム初期表示の確認（全フィールドの存在、購入日の初期値、カテゴリ選択肢）
    - 保存成功時の成功メッセージ表示確認
    - 保存失敗時のエラーメッセージ表示確認
    - _Requirements: 1.1, 1.2, 1.3, 3.2, 3.4_

- [ ] 9. Final checkpoint - 全体統合の確認
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- `*` マーク付きのタスクはオプションで、MVP実装時にはスキップ可能
- 各タスクは特定の要件を参照しており、トレーサビリティを確保
- チェックポイントで段階的に動作確認を実施
- プロパティテストは fast-check を使用し、各プロパティ100回以上のイテレーションを実行
- ユニットテストは Vitest を使用
- Amplify Data Client のモックには Vitest の vi.mock を使用
