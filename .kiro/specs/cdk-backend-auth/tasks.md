# Implementation Plan: CDK Backend & Auth

## Overview

Amplify Gen 2 から AWS CDK ベースのバックエンドに移行する。CDK で Cognito 認証 + AppSync GraphQL API + DynamoDB を構築し、フロントエンドに認証 UI を追加して、ユーザーごとのデータ分離を実現する。

## Tasks

- [x] 1. CDK プロジェクトの初期セットアップ
  - [x] 1.1 `infra/` ディレクトリに CDK プロジェクトを作成する
    - `infra/bin/app.ts`（エントリポイント）、`infra/lib/`（スタック定義）、`infra/cdk.json`、`infra/tsconfig.json`、`infra/package.json` を作成
    - TypeScript 5.9 を使用し、`aws-cdk-lib`、`constructs` を依存関係に追加
    - 環境名（dev, staging, prod）をコンテキストパラメータとして受け取り、リソース名プレフィックスに使用する仕組みを実装
    - _Requirements: 1.1, 1.2, 1.4_

  - [x] 1.2 AuthStack のスタッククラスを作成する（`infra/lib/auth-stack.ts`）
    - `AuthStackProps` インターフェースを定義（envName を含む）
    - 空のスタッククラスを作成し、`userPool` プロパティを公開する構造を準備
    - _Requirements: 1.3_

  - [x] 1.3 ApiStack のスタッククラスを作成する（`infra/lib/api-stack.ts`）
    - `ApiStackProps` インターフェースを定義（envName, userPool を含む）
    - 空のスタッククラスを作成
    - `infra/bin/app.ts` で AuthStack → ApiStack の依存関係を明示
    - _Requirements: 1.3_

- [x] 2. Cognito 認証スタックの実装
  - [x] 2.1 AuthStack に Cognito UserPool を実装する
    - メールアドレスをサインイン識別子として設定
    - セルフサインアップを有効化し、メールアドレスによる自動検証を設定
    - パスワードポリシー: 最低8文字、大文字・小文字・数字・記号を要求
    - サインアップ時に確認コードをメール送信する設定
    - _Requirements: 2.1, 2.2, 2.3, 2.6_

  - [x] 2.2 AuthStack に UserPool Client を実装する
    - SRP 認証フローを有効化
    - トークン有効期限: アクセストークン1時間、リフレッシュトークン30日
    - _Requirements: 2.4, 2.5_

  - [x] 2.3 AuthStack の CloudFormation 出力を設定する
    - UserPool ID、UserPool Client ID、AWS リージョンを CfnOutput として公開
    - _Requirements: 2.7_

  - [x] 2.4 AuthStack のユニットテストを作成する（`infra/__tests__/auth-stack.test.ts`）
    - `aws-cdk-lib/assertions` を使用して UserPool の設定値（メール認証、パスワードポリシー、セルフサインアップ）を検証
    - UserPool Client の設定値（SRP フロー、トークン有効期限）を検証
    - CloudFormation 出力の存在を確認
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7_

- [x] 3. Checkpoint - AuthStack の実装確認
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. AppSync GraphQL API と DynamoDB の実装
  - [x] 4.1 GraphQL スキーマファイルを作成する（`infra/graphql/schema.graphql`）
    - SakeCategory 列挙型（NIHONSHU, BEER, WINE, WHISKY, SHOCHU, OTHER）を定義
    - PurchaseRecord 型（id, owner, sakeName, storeName, price, purchaseDate, category, memo, createdAt, updatedAt）を定義
    - DrinkingRecord 型（id, owner, sakeName, placeName, price, drinkingDate, category, drinkingMethod, rating, memo, createdAt, updatedAt）を定義
    - Query（getPurchaseRecord, listPurchaseRecords, getDrinkingRecord, listDrinkingRecords）を定義
    - Mutation（create/update/delete の各レコード型）と Input 型を定義
    - _Requirements: 3.2, 3.3, 3.4, 3.5_

  - [x] 4.2 ApiStack に DynamoDB テーブルを実装する
    - PurchaseRecord テーブル: id（パーティションキー）、PAY_PER_REQUEST 課金、owner の GSI（owner-index）
    - DrinkingRecord テーブル: id（パーティションキー）、PAY_PER_REQUEST 課金、owner の GSI（owner-index）
    - 削除ポリシー: dev → DESTROY、prod → RETAIN（envName で分岐）
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 4.3 ApiStack に AppSync GraphQL API を実装する
    - Cognito UserPool を既定の認証モードとして設定
    - GraphQL スキーマファイルを読み込み
    - DynamoDB データソースを作成し、各テーブルへの読み書き IAM ロールを設定
    - _Requirements: 3.1, 4.6_

  - [x] 4.4 AppSync リゾルバーを実装する
    - create ミューテーション: `$ctx.identity.sub` を owner に自動設定、createdAt/updatedAt を自動付与
    - list クエリ: owner-index GSI を使い `owner = $ctx.identity.sub` でフィルタ
    - get クエリ: owner 一致を検証
    - update ミューテーション: owner 一致を検証、updatedAt を更新
    - delete ミューテーション: owner 一致を検証
    - _Requirements: 3.5, 3.6, 7.2, 7.3, 7.4_

  - [x] 4.5 ApiStack の CloudFormation 出力を設定する
    - GraphQL API エンドポイント URL、AWS リージョンを CfnOutput として公開
    - _Requirements: 3.7_

  - [x] 4.6 ApiStack のユニットテストを作成する（`infra/__tests__/api-stack.test.ts`）
    - AppSync API の認証モード（Cognito）を検証
    - DynamoDB テーブルの主キー、課金モード、GSI を検証
    - リゾルバーの存在を確認
    - CloudFormation 出力の存在を確認
    - _Requirements: 3.1, 3.7, 4.1, 4.2, 4.3, 4.4, 4.6_

- [x] 5. Checkpoint - ApiStack の実装確認
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. CDK プロパティベーステスト
  - [x] 6.1 環境名プレフィックスのプロパティテストを作成する（`infra/__tests__/env-prefix.property.test.ts`）
    - **Property 1: 環境名がリソース名プレフィックスに反映される**
    - **Validates: Requirements 1.4**

  - [x] 6.2 環境別削除ポリシーのプロパティテストを作成する（`infra/__tests__/deletion-policy.property.test.ts`）
    - **Property 4: 環境別削除ポリシー**
    - **Validates: Requirements 4.5**

- [x] 7. 設定ファイル生成スクリプトの実装
  - [x] 7.1 `infra/scripts/generate-outputs.ts` を作成する
    - CloudFormation スタック出力を AWS SDK で取得
    - `amplify_outputs.json` 互換の JSON 構造を生成（auth セクション + data セクション + version: '1.3'）
    - プロジェクトルートに `amplify_outputs.json` として出力
    - `infra/package.json` に `generate-outputs` スクリプトを追加
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 7.2 設定ファイル生成のプロパティテストを作成する（`infra/__tests__/generate-outputs.property.test.ts`）
    - **Property 5: 設定ファイル生成の構造保証**
    - **Validates: Requirements 5.2, 5.3, 5.4**

- [x] 8. Checkpoint - CDK インフラ全体の確認
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. フロントエンド認証コンテキストの実装
  - [x] 9.1 認証コンテキストを作成する（`src/features/auth/AuthContext.tsx`）
    - `AuthContextValue` インターフェース（user, isAuthenticated, isLoading, signIn, signUp, confirmSignUp, signOut）を定義
    - `AuthUser` 型（userId, email）を定義
    - Amplify Auth SDK（`signIn`, `signUp`, `confirmSignUp`, `signOut`, `getCurrentUser`）をラップ
    - 初回マウント時に認証状態を確認する `useEffect` を実装
    - _Requirements: 6.1, 6.6, 7.1_

  - [x] 9.2 パスワードバリデーション関数を作成する（`src/features/auth/validation.ts`）
    - 8文字以上、大文字、小文字、数字、記号の各条件をチェック
    - 個別のエラーメッセージを返却
    - _Requirements: 2.3_

  - [x] 9.3 パスワードバリデーションのプロパティテストを作成する（`src/features/auth/__tests__/password-validation.property.test.ts`）
    - **Property 2: パスワードポリシーバリデーション**
    - **Validates: Requirements 2.3**

- [x] 10. フロントエンド認証 UI コンポーネントの実装
  - [x] 10.1 サインインフォームを作成する（`src/features/auth/components/SignInForm.tsx`）
    - メールアドレスとパスワードの入力フィールド
    - サインアップ画面への切り替えリンク
    - エラーメッセージ表示（NotAuthorizedException, UserNotConfirmedException 等）
    - 和モダンテーマに合わせたデザイン
    - _Requirements: 6.2, 6.7_

  - [x] 10.2 サインアップフォームを作成する（`src/features/auth/components/SignUpForm.tsx`）
    - メールアドレスとパスワードの入力フィールド
    - パスワードバリデーション表示
    - サインイン画面への切り替えリンク
    - エラーメッセージ表示（UsernameExistsException, InvalidPasswordException 等）
    - _Requirements: 6.3, 6.7_

  - [x] 10.3 確認コード入力フォームを作成する（`src/features/auth/components/ConfirmSignUpForm.tsx`）
    - 確認コード入力フィールド
    - エラーメッセージ表示（CodeMismatchException 等）
    - _Requirements: 6.4, 6.7_

  - [x] 10.4 認証ページコンテナを作成する（`src/features/auth/components/AuthPage.tsx`）
    - SignInForm / SignUpForm / ConfirmSignUpForm を状態に応じて切り替え
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 10.5 AuthGuard コンポーネントを作成する（`src/features/auth/components/AuthGuard.tsx`）
    - 認証済み → children を表示
    - 未認証 → AuthPage を表示
    - ローディング中 → ローディング表示
    - _Requirements: 6.1_

  - [x] 10.6 認証 UI のユニットテストを作成する（`src/features/auth/__tests__/AuthPage.test.tsx`）
    - サインイン/サインアップフォームの切り替えを検証
    - AuthGuard の認証状態に応じた表示切替を検証
    - エラーメッセージの表示を検証
    - _Requirements: 6.1, 6.2, 6.3, 6.5_

- [x] 11. App.tsx の統合とナビゲーション更新
  - [x] 11.1 App.tsx に AuthGuard と認証 UI を統合する
    - `AuthProvider` でアプリ全体をラップ
    - `AuthGuard` で認証チェックを追加
    - ナビゲーションバーにサインアウトボタンを追加
    - _Requirements: 6.1, 6.5, 6.6_

  - [x] 11.2 既存のデータアクセスコードを Cognito 認証ベースに移行する
    - `generateClient` の認証モードを `apiKey` から `userPool` に変更
    - 購入登録・飲酒登録・記録一覧の各 hooks で認証モードの更新を確認
    - _Requirements: 7.1_

  - [x] 11.3 owner ベース認可のプロパティテストを作成する（`src/features/auth/__tests__/owner-auth.property.test.ts`）
    - **Property 3: owner ベース認可 round-trip**
    - **Validates: Requirements 3.6, 7.2, 7.3**

- [x] 12. Amplify ディレクトリの整理
  - [x] 12.1 `amplify/` ディレクトリを削除し、CDK ベースに完全移行する
    - `amplify/data/resource.ts` と `amplify/backend.ts` を削除
    - `src/__mocks__/` の Amplify モックを CDK 互換に更新（必要に応じて）
    - _Requirements: 1.1_

- [x] 13. Final checkpoint - 全体の動作確認
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- タスクに `*` が付いているものはオプション（テスト関連）でスキップ可能
- 各タスクは具体的な Requirements を参照しており、トレーサビリティを確保
- CDK インフラ（タスク1-8）→ フロントエンド認証（タスク9-11）→ 整理（タスク12）の順で段階的に実装
- プロパティテストは fast-check を使用し、最低100イテレーション実行
- チェックポイントで段階的に動作確認を実施
