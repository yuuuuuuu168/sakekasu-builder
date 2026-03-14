# Implementation Plan: 飲んだお酒の登録

## Overview

既存の購入登録機能（sake-purchase-registration）と同じアーキテクチャパターンを踏襲し、Amplify Data スキーマに ServingStyle 列挙型と DrinkingRecord モデルを追加する。飲み方のカテゴリ連動マッピング、再利用可能な StarRating コンポーネント、連続登録時の「飲んだ場所」保持を実装する。バリデーションロジックをカスタムフックとして分離し、テスタビリティを確保する。

## Tasks

- [x] 1. Amplify Data スキーマ拡張と型定義
  - [x] 1.1 `amplify/data/resource.ts` に ServingStyle enum と DrinkingRecord モデルを追加する
    - ServingStyle: GLASS, ICHIGO, BOTTLE, CAN, OTHER
    - DrinkingRecord: sakeName(string required), placeName(string required), price(integer optional), drinkingDate(date required), category(ref SakeCategory required), drinkingMethod(string required), servingStyle(ref ServingStyle required), rating(integer required), memo(string optional)
    - publicApiKey 認証を設定する
    - _Requirements: 4.1_
  - [x] 1.2 `src/features/drinking/types.ts` を作成する
    - DrinkingFormData, DrinkingValidationErrors インターフェースを定義
    - ServingStyle 型と SERVING_STYLES 定数、SERVING_STYLE_LABELS マッピングを定義
    - DRINKING_METHODS_MAP（SakeCategory → DrinkingMethod[] のマッピング）を定義
    - getDrinkingMethodsByCategory ユーティリティ関数を実装
    - SakeCategory は `src/features/purchase/types.ts` から import して共有する
    - _Requirements: 1.3, 1.4, 1.6, 4.1_
  - [x] 1.3 Property 1 のプロパティテストを作成する（`drinkingMethods.property.test.ts`）
    - **Property 1: カテゴリ変更時の飲み方連動**
    - ランダムな SakeCategory ペア（変更前・変更後）で、getDrinkingMethodsByCategory の返り値が対応する飲み方リストと一致し、カテゴリ変更時に飲み方がリセットされることを検証
    - **Validates: Requirements 1.4, 1.5**

- [x] 2. Checkpoint - スキーマと型定義の確認
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. バリデーションロジックの実装
  - [x] 3.1 `src/features/drinking/hooks/useDrinkingValidation.ts` を作成する
    - validateField: フィールド単位のバリデーション
    - validateAll: 全フィールド一括バリデーション
    - isValid: 全フィールドの有効性判定
    - clearErrors: エラーのクリア
    - バリデーションルール: 銘柄名・飲んだ場所は空文字/空白のみ不可、価格は任意で入力時は0以上の整数、飲んだ日は本日以前、カテゴリ・飲み方・提供形態は有効な列挙値、Ratingは1〜5
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  - [x] 3.2 Property 2 のプロパティテストを作成する（`validation.property.test.ts`）
    - **Property 2: 必須フィールド空欄バリデーション**
    - 必須フィールド（銘柄名、飲んだ場所、飲んだ日、Sake_Category、Drinking_Method、Serving_Style、Rating）のランダムな部分集合を空にした入力データでバリデーション失敗を検証
    - **Validates: Requirements 2.1**
  - [x] 3.3 Property 3 のプロパティテストを作成する（`validation.property.test.ts`）
    - **Property 3: 無効な価格入力バリデーション**
    - 非数値文字列・負の数値でバリデーション失敗と「価格は0以上の数値で入力してください」エラーメッセージを検証
    - **Validates: Requirements 2.2, 2.3**
  - [x] 3.4 Property 4 のプロパティテストを作成する（`validation.property.test.ts`）
    - **Property 4: 未来日付バリデーション**
    - 明日以降のランダムな日付でバリデーション失敗と「飲んだ日は本日以前の日付を入力してください」エラーメッセージを検証
    - **Validates: Requirements 2.4**
  - [x] 3.5 Property 5 のプロパティテストを作成する（`validation.property.test.ts`）
    - **Property 5: Rating範囲制限**
    - 1〜5の範囲外のランダムな整数値がクランプされることを検証（0以下は1に、6以上は5に）
    - **Validates: Requirements 2.5**
  - [x] 3.6 Property 6 のプロパティテストを作成する（`validation.property.test.ts`）
    - **Property 6: 有効入力のバリデーション通過**
    - 全フィールドが有効なランダム入力データ（銘柄名・場所名が非空白文字列、飲んだ日が本日以前、カテゴリが有効な列挙値、飲み方がカテゴリに対応する値、提供形態が有効な列挙値、Ratingが1〜5、価格が未入力または0以上の整数）でバリデーション成功を検証
    - **Validates: Requirements 2.6**

- [x] 4. Checkpoint - バリデーションロジックの確認
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. ストレージフックの実装
  - [x] 5.1 `src/features/drinking/hooks/useDrinkingStorage.ts` を作成する
    - Amplify Data Client を使用して DrinkingRecord の保存（create mutation）を実装
    - saveDrinking: DrinkingFormData を受け取り SaveResult を返す
    - isSaving: 保存中の状態管理
    - エラーハンドリング: ネットワークエラー・APIエラーをキャッチし SaveResult.error に設定
    - _Requirements: 3.1, 3.4, 3.5, 4.1_
  - [x] 5.2 Property 9 のプロパティテストを作成する（`storage.property.test.ts`）
    - **Property 9: DrinkingRecord のラウンドトリップ**
    - ランダムな有効 DrinkingRecord を保存後に取得し、元データと同等の内容（銘柄名、場所名、価格、飲んだ日、カテゴリ、飲み方、提供形態、Rating、メモ）であることを検証
    - Amplify Data Client をモックして検証
    - **Validates: Requirements 4.3**
  - [x] 5.3 Property 10 のプロパティテストを作成する（`storage.property.test.ts`）
    - **Property 10: 登録日時降順取得**
    - ランダムな複数 DrinkingRecord を保存後に取得し、createdAt の降順であることを検証
    - **Validates: Requirements 4.2**

- [x] 6. StarRating コンポーネントの実装
  - [x] 6.1 `src/features/drinking/components/StarRating.tsx` を作成する
    - StarRatingProps: value(number), onChange(callback), maxStars(default 5)
    - 5つの星アイコン（lucide-react の Star）を横並びで表示
    - クリックで評価値を設定（クリックされた星までを塗りつぶし）
    - 現在の数値を星の横にテキスト表示（例: "4/5"）
    - 初期値は未選択状態（value=0、全て空の星）
    - ホバー時にプレビュー表示（Framer Motion でスケールアニメーション）
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 6.2 Property 12 のプロパティテストを作成する（`StarRating.property.test.tsx`）
    - **Property 12: 星評価UIの表示状態**
    - 1〜5のランダムな評価値に対して、その値までの星が塗りつぶし状態で表示され、残りが空の状態で表示され、かつ現在の数値がテキストで表示されることを検証
    - **Validates: Requirements 6.2, 6.3**
  - [x] 6.3 StarRating のユニットテストを作成する（`StarRating.test.tsx`）
    - 初期状態（未選択）の表示確認
    - クリックによる評価値設定の確認
    - 数値テキスト表示の確認
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 7. Checkpoint - StarRating とストレージの確認
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. 飲酒登録フォームUIの実装
  - [x] 8.1 `src/features/drinking/hooks/useDrinkingForm.ts` を作成する
    - フォーム状態管理（DrinkingFormData の初期値設定、飲んだ日は当日）
    - useDrinkingValidation と useDrinkingStorage を統合
    - handleChange: カテゴリ変更時に drinkingMethod をリセットする連動ロジック
    - handleSubmit: バリデーション → 保存 → 成功時リセット（飲んだ場所は保持）/ 失敗時入力保持
    - 連続登録時の「飲んだ場所」保持ロジック
    - _Requirements: 1.2, 1.4, 1.5, 3.1, 3.2, 3.3, 3.4, 3.5, 5.1, 5.3_
  - [x] 8.2 `src/features/drinking/components/DrinkingForm.tsx` を作成する
    - shadcn/ui コンポーネントでフォームフィールドを構築
    - 銘柄名・飲んだ場所: Input、価格: Input(type=number) + 円マーク接頭辞、飲んだ日: Popover+Calendar、カテゴリ: Select、飲み方: Select（カテゴリ連動）、提供形態: Select、評価: StarRating、メモ: Textarea
    - バリデーションエラーをフィールド横に表示（onBlur 時）
    - 登録ボタンの有効/無効制御、送信中ローディングスピナー表示
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.6_
  - [x] 8.3 Framer Motion アニメーションを追加する
    - フォームカード: フェードイン + 下からスライド
    - 成功メッセージ: 右上からスライドイン → 3秒後フェードアウト（Toast）
    - エラーメッセージ: AnimatePresence でスライドダウン表示
    - 登録ボタン: ホバー時スケールアップ
    - 星評価: ホバー時スケールアップ、クリック時バウンス
    - _Requirements: 1.1_
  - [x] 8.4 Property 7 のプロパティテストを作成する（`DrinkingForm.property.test.tsx`）
    - **Property 7: 保存成功後のフォームリセット（飲んだ場所保持）**
    - ランダムな有効入力データ + 保存成功モックでフォームリセットを検証。飲んだ場所のみ前回値が保持されることを検証
    - **Validates: Requirements 3.3, 5.1, 5.3**
  - [x] 8.5 Property 8 のプロパティテストを作成する（`DrinkingForm.property.test.tsx`）
    - **Property 8: 保存失敗時の入力保持**
    - ランダムな有効入力データ + 保存失敗モックで全フィールドの入力値保持を検証
    - **Validates: Requirements 3.5**
  - [x] 8.6 Property 11 のプロパティテストを作成する（`DrinkingForm.property.test.tsx`）
    - **Property 11: 連続登録時の成功メッセージ表示**
    - ランダムな回数（2〜10）の有効入力データで各登録後に成功メッセージが表示されることを検証
    - **Validates: Requirements 5.2**

- [x] 9. Checkpoint - フォームUIの確認
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. ページ統合とルーティング
  - [x] 10.1 `src/features/drinking/components/DrinkingRegistrationPage.tsx` を作成する
    - DrinkingForm を含むページコンポーネント
    - ページタイトル「🍶 飲んだお酒を登録」と ThemeToggle を配置
    - グラスモーフィズム風カードレイアウト（rounded-xl, shadow-lg, 半透明背景）
    - レスポンシブ対応（モバイルファースト）
    - _Requirements: 1.1_
  - [x] 10.2 `src/App.tsx` に DrinkingRegistrationPage を統合する
    - 既存の PurchaseRegistrationPage と並べて配置（またはルーティング追加）
    - Toaster コンポーネントの共有利用
    - _Requirements: 1.1, 3.2_
  - [x] 10.3 DrinkingForm のユニットテストを作成する（`DrinkingForm.test.tsx`）
    - フォーム初期表示の確認（全フィールドの存在、飲んだ日の初期値、カテゴリ選択肢、提供形態選択肢）
    - 星評価UIの初期状態（未選択）の確認
    - カテゴリ変更時の飲み方選択肢の動的更新確認
    - 保存成功時の成功メッセージ表示確認
    - 保存失敗時のエラーメッセージ表示確認
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 3.2, 3.4, 6.4_

- [x] 11. Final checkpoint - 全体統合の確認
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- `*` マーク付きのタスクはオプションで、MVP実装時にはスキップ可能
- 各タスクは特定の要件を参照しており、トレーサビリティを確保
- チェックポイントで段階的に動作確認を実施
- プロパティテストは fast-check を使用し、各プロパティ100回以上のイテレーションを実行
- ユニットテストは Vitest + Testing Library を使用
- Amplify Data Client のモックには Vitest の vi.mock を使用
- SakeCategory は既存の `src/features/purchase/types.ts` から import して共有する
- 購入登録機能と同じ「和モダン」デザインテーマ・shadcn/ui コンポーネントを踏襲する
