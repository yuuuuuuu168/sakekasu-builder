# Requirements Document

## Introduction

sakekasu-builder.com のバックエンドインフラストラクチャを、現在の Amplify Gen 2 から AWS CDK ベースに移行する。AppSync GraphQL API + DynamoDB によるデータ層と、Amazon Cognito によるユーザー認証を CDK で構築し、フロントエンド（React 19）との接続を維持する。

## Glossary

- **CDK_Stack**: AWS CDK で定義されるバックエンドインフラストラクチャのスタック
- **Auth_Stack**: Amazon Cognito のユーザープール・クライアントを管理する CDK スタック
- **API_Stack**: AppSync GraphQL API と DynamoDB テーブルを管理する CDK スタック
- **User_Pool**: Amazon Cognito のユーザープール。ユーザーの登録・認証を管理する
- **User_Pool_Client**: User_Pool に紐づくアプリケーションクライアント
- **GraphQL_API**: AWS AppSync で構築される GraphQL API エンドポイント
- **PurchaseRecord_Table**: 購入記録を格納する DynamoDB テーブル
- **DrinkingRecord_Table**: 飲酒記録を格納する DynamoDB テーブル
- **Frontend_Config**: フロントエンドが AWS リソースに接続するための設定ファイル（amplify_outputs.json 相当）
- **SakeCategory**: お酒のカテゴリ列挙型（NIHONSHU, BEER, WINE, WHISKY, SHOCHU, OTHER）
- **Authenticated_User**: Cognito で認証済みのユーザー

## Requirements

### Requirement 1: CDK プロジェクト構成

**User Story:** As a 開発者, I want CDK プロジェクトを独立したディレクトリで管理したい, so that フロントエンドとバックエンドのコードを明確に分離できる

#### Acceptance Criteria

1. THE CDK_Stack SHALL `infra/` ディレクトリ配下に CDK アプリケーションのエントリポイント、スタック定義、および CDK 設定ファイルを配置する
2. THE CDK_Stack SHALL TypeScript で記述し、フロントエンドと同じ TypeScript バージョン（5.9）を使用する
3. THE CDK_Stack SHALL Auth_Stack と API_Stack を個別のスタッククラスとして定義し、スタック間の依存関係を明示する
4. THE CDK_Stack SHALL 環境名（dev, staging, prod）をコンテキストパラメータとして受け取り、リソース名のプレフィックスに使用する

### Requirement 2: Cognito 認証

**User Story:** As a ユーザー, I want メールアドレスでサインアップ・サインインしたい, so that 自分の記録を安全に管理できる

#### Acceptance Criteria

1. THE Auth_Stack SHALL メールアドレスをサインイン識別子とする User_Pool を作成する
2. THE Auth_Stack SHALL User_Pool にセルフサインアップを有効化し、メールアドレスによる自動検証を設定する
3. THE Auth_Stack SHALL User_Pool のパスワードポリシーとして最低8文字、大文字・小文字・数字・記号を要求する
4. THE Auth_Stack SHALL User_Pool_Client を作成し、SRP 認証フローを有効化する
5. THE Auth_Stack SHALL User_Pool_Client でトークンの有効期限をアクセストークン1時間、リフレッシュトークン30日に設定する
6. WHEN ユーザーがサインアップした場合, THE User_Pool SHALL 確認コードをメールアドレスに送信する
7. THE Auth_Stack SHALL User_Pool の ID、User_Pool_Client の ID、および AWS リージョンを CloudFormation 出力として公開する

### Requirement 3: AppSync GraphQL API

**User Story:** As a 開発者, I want GraphQL API でデータの CRUD 操作を行いたい, so that フロントエンドから型安全にデータアクセスできる

#### Acceptance Criteria

1. THE API_Stack SHALL AWS AppSync の GraphQL API を作成し、Cognito User_Pool を既定の認証モードとして設定する
2. THE API_Stack SHALL GraphQL スキーマに PurchaseRecord 型を定義し、sakeName（必須・文字列）、storeName（必須・文字列）、price（必須・整数）、purchaseDate（必須・AWSDate）、category（必須・SakeCategory）、memo（任意・文字列）フィールドを含める
3. THE API_Stack SHALL GraphQL スキーマに DrinkingRecord 型を定義し、sakeName（必須・文字列）、placeName（必須・文字列）、price（任意・整数）、drinkingDate（必須・AWSDate）、category（必須・SakeCategory）、drinkingMethod（必須・文字列）、rating（必須・整数）、memo（任意・文字列）フィールドを含める
4. THE API_Stack SHALL SakeCategory 列挙型を NIHONSHU, BEER, WINE, WHISKY, SHOCHU, OTHER の値で定義する
5. THE API_Stack SHALL PurchaseRecord および DrinkingRecord に対して create, update, delete のミューテーションと get, list のクエリを定義する
6. THE API_Stack SHALL 各レコード型に owner フィールドを追加し、Authenticated_User が自身のレコードのみ操作できるよう認可ルールを設定する
7. THE API_Stack SHALL GraphQL API のエンドポイント URL と API キー（存在する場合）を CloudFormation 出力として公開する

### Requirement 4: DynamoDB テーブル

**User Story:** As a 開発者, I want データを DynamoDB に永続化したい, so that スケーラブルで低コストなデータストレージを利用できる

#### Acceptance Criteria

1. THE API_Stack SHALL PurchaseRecord_Table を作成し、id（パーティションキー・文字列）を主キーとする
2. THE API_Stack SHALL DrinkingRecord_Table を作成し、id（パーティションキー・文字列）を主キーとする
3. THE API_Stack SHALL 各テーブルの課金モードを PAY_PER_REQUEST（オンデマンド）に設定する
4. THE API_Stack SHALL 各テーブルに owner フィールドの GSI（グローバルセカンダリインデックス）を作成し、ユーザーごとのレコード検索を効率化する
5. THE API_Stack SHALL 各テーブルの削除ポリシーを開発環境では DESTROY、本番環境では RETAIN に設定する
6. THE API_Stack SHALL AppSync のリゾルバーから各 DynamoDB テーブルへの読み書きアクセスを許可する IAM ロールを設定する

### Requirement 5: フロントエンド接続設定

**User Story:** As a 開発者, I want CDK のデプロイ後にフロントエンドの接続設定を自動生成したい, so that 手動設定なしでフロントエンドからバックエンドに接続できる

#### Acceptance Criteria

1. THE CDK_Stack SHALL デプロイ後に amplify_outputs.json 互換の設定ファイルを生成するスクリプトを提供する
2. THE Frontend_Config SHALL Auth セクションに User_Pool の ID、User_Pool_Client の ID、AWS リージョンを含める
3. THE Frontend_Config SHALL Data セクションに GraphQL API のエンドポイント URL、AWS リージョン、既定の認証モード（userPool）を含める
4. THE Frontend_Config SHALL 既存の `Amplify.configure(outputs)` 呼び出しと互換性のある JSON 構造を出力する

### Requirement 6: フロントエンド認証 UI

**User Story:** As a ユーザー, I want アプリケーション上でサインアップ・サインイン・サインアウトしたい, so that 自分のアカウントで記録を管理できる

#### Acceptance Criteria

1. WHEN Authenticated_User がサインインしていない場合, THE Frontend_Config SHALL サインイン画面を表示する
2. THE Frontend_Config SHALL メールアドレスとパスワードによるサインインフォームを提供する
3. THE Frontend_Config SHALL 新規ユーザー向けのサインアップフォーム（メールアドレス、パスワード）を提供する
4. WHEN ユーザーがサインアップした場合, THE Frontend_Config SHALL メール確認コード入力画面を表示する
5. WHEN Authenticated_User がサインイン済みの場合, THE Frontend_Config SHALL ナビゲーションバーにサインアウトボタンを表示する
6. WHEN Authenticated_User がサインアウトボタンを押した場合, THE Frontend_Config SHALL セッションを終了しサインイン画面に遷移する
7. THE Frontend_Config SHALL サインイン・サインアップフォームを和モダンテーマに合わせたデザインで表示する

### Requirement 7: データアクセスの認証移行

**User Story:** As a 開発者, I want 既存のデータアクセスコードを Cognito 認証ベースに移行したい, so that ユーザーごとのデータ分離を実現できる

#### Acceptance Criteria

1. THE Frontend_Config SHALL generateClient の認証モードを apiKey から userPool に変更する
2. WHEN Authenticated_User がレコードを作成した場合, THE GraphQL_API SHALL レコードの owner フィールドに Authenticated_User の ID を自動設定する
3. WHEN Authenticated_User がレコードを一覧取得した場合, THE GraphQL_API SHALL Authenticated_User が所有するレコードのみを返却する
4. IF 未認証のリクエストが GraphQL_API に送信された場合, THEN THE GraphQL_API SHALL 401 Unauthorized エラーを返却する
