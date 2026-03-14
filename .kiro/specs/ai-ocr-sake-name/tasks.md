# Implementation Plan: 画像からの銘柄名自動取得（AI OCR）

## 概要

Amazon Rekognition DetectText API を使用して、お酒のラベル画像から銘柄名を自動抽出する機能を実装する。バックエンド（CDK + Lambda）→ フロントエンド（フック + UI）の順に段階的に構築し、各ステップでテストを通じて正当性を検証する。

## Tasks

- [x] 1. GraphQL スキーマと OCR Lambda の実装
  - [x] 1.1 GraphQL スキーマに OcrResult 型と analyzeSakeLabel ミューテーションを追加する
    - `infra/graphql/schema.graphql` に `OcrResult` 型（sakeName: String, confidence: Float!, rawTexts: [String!]!）を追加
    - `Mutation` に `analyzeSakeLabel(imageKey: String!): OcrResult!` を追加
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 1.2 銘柄名抽出ロジック extractSakeName を実装する
    - `infra/lambda/ocr-analyzer/extractSakeName.ts` を作成
    - Rekognition TextDetection 配列から LINE タイプのみを対象に銘柄名を抽出
    - 非銘柄パターン（容量表記、アルコール度数、製造者名、原材料、保存方法）のフィルタリング
    - フィルタ後の最高 Confidence 候補を選択、候補なしの場合は sakeName: null, confidence: 0.0 を返す
    - Confidence を 0-100 スケールから 0.0-1.0 スケールに正規化
    - rawTexts に全 LINE テキストを含める
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 1.3 Property 2: Confidence スコアの範囲不変条件のプロパティテストを書く
    - **Property 2: Confidence スコアの範囲不変条件**
    - `infra/lambda/ocr-analyzer/__tests__/extractSakeName.property.test.ts` に作成
    - ランダムな TextDetection リストを生成し、返される confidence が 0.0〜1.0 の範囲内であることを検証
    - **Validates: Requirements 3.2**

  - [x] 1.4 Property 3: 最高 Confidence 候補の選択のプロパティテストを書く
    - **Property 3: 最高 Confidence 候補の選択**
    - 複数候補を含むランダムな TextDetection リストを生成し、最高 Confidence の候補が選択されることを検証
    - **Validates: Requirements 3.3**

  - [x] 1.5 Property 4: 非銘柄情報のフィルタリングのプロパティテストを書く
    - **Property 4: 非銘柄情報のフィルタリング**
    - 容量表記・アルコール度数・製造者名等の非銘柄パターンを含むランダムな TextDetection リストを生成し、それらが銘柄名として選択されないことを検証
    - **Validates: Requirements 3.4**

  - [x] 1.6 Property 5: rawTexts の完全性のプロパティテストを書く
    - **Property 5: rawTexts の完全性**
    - ランダムな TextDetection リストを生成し、rawTexts が全 LINE テキストの DetectedText を含むことを検証
    - **Validates: Requirements 3.6**

  - [x] 1.7 OCR Lambda ハンドラーを実装する
    - `infra/lambda/ocr-analyzer/index.ts` を作成（既存 presigned-url Lambda と同じ ESM + createRequire パターン）
    - `identity.sub` と `imageKey` プレフィックスの照合によるアクセス制御
    - S3 `GetObjectCommand` で画像取得
    - Rekognition `DetectTextCommand` でテキスト検出
    - `extractSakeName()` で銘柄名抽出し OcrResult を返却
    - エラーハンドリング: 認証エラー、S3 取得エラー、Rekognition エラー
    - _Requirements: 2.4, 2.5, 7.2, 7.3, 7.4_

  - [x] 1.8 Property 1: アクセス制御のプロパティテストを書く
    - **Property 1: アクセス制御 — imageKey プレフィックス不一致時の拒否**
    - `infra/lambda/ocr-analyzer/__tests__/validateAccess.property.test.ts` に作成
    - ランダムな sub/imageKey ペアを生成し、プレフィックス不一致時にエラーが返ることを検証
    - **Validates: Requirements 2.5, 7.2, 7.3, 7.4**

  - [x] 1.9 `infra/lambda/ocr-analyzer/package.json` を作成する
    - `@aws-sdk/client-s3` と `@aws-sdk/client-rekognition` を依存関係に追加
    - 既存 presigned-url Lambda の package.json パターンを踏襲
    - _Requirements: 2.4, 2.6, 6.1, 6.2_

- [x] 2. CDK インフラ構築
  - [x] 2.1 api-stack.ts に OCR Lambda と AppSync リゾルバーを追加する
    - `infra/lib/api-stack.ts` に OCR Analyzer Lambda（NodejsFunction）を追加
    - runtime: NODEJS_20_X, timeout: 30秒, memorySize: 512MB
    - 環境変数: BUCKET_NAME
    - bundling: ESM format + createRequire バナー（既存パターン踏襲）
    - S3 バケットの読み取り権限を付与（`imageBucket.grantRead`）
    - Rekognition DetectText の IAM ポリシーを付与
    - AppSync Lambda データソースとリゾルバー（Mutation.analyzeSakeLabel）を作成
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1_

- [x] 3. チェックポイント - バックエンド実装の確認
  - CDK のシンセサイズが成功すること、extractSakeName のテストが全て通ることを確認する。問題があればユーザーに確認する。

- [x] 4. フロントエンド GraphQL 定義と OCR フックの実装
  - [x] 4.1 GraphQL ミューテーション定義を追加する
    - `src/graphql/mutations.ts` に `analyzeSakeLabel` ミューテーション文字列を追加
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 4.2 useOcrAnalysis カスタムフックを実装する
    - `src/features/image/hooks/useOcrAnalysis.ts` を作成
    - `analyzeImage(imageKey)`: AppSync 経由で analyzeSakeLabel ミューテーションを呼び出し
    - `isAnalyzing`, `ocrResult`, `ocrError`, `resetOcr` の状態管理
    - エラーハンドリング: ネットワークエラー → 「読み取りに失敗しました。もう一度お試しください」、タイムアウト → 「読み取りがタイムアウトしました。もう一度お試しください」、銘柄名未検出 → 「銘柄名を読み取れませんでした。手動で入力してください」
    - _Requirements: 4.1, 4.2, 5.1, 5.2, 5.3, 5.4_

  - [x] 4.3 Property 6: エラー時のフォーム値保持のプロパティテストを書く
    - **Property 6: エラー時のフォーム値保持**
    - `src/features/image/__tests__/useOcrAnalysis.property.test.ts` に作成
    - ランダムな既存 sakeName 値とエラー種別を生成し、エラー後も値が保持されることを検証
    - **Validates: Requirements 5.5**

  - [x] 4.4 useOcrAnalysis のユニットテストを書く
    - `src/features/image/__tests__/useOcrAnalysis.test.ts` に作成
    - analyzeSakeLabel ミューテーションが正しく呼び出されること
    - 成功時に ocrResult が設定されること
    - 各エラー種別で適切な ocrError メッセージが設定されること
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 5. ImageUploadArea の OCR UI 拡張
  - [x] 5.1 ImageUploadArea コンポーネントに OCR トリガーボタンと結果メッセージを追加する
    - `src/features/image/components/ImageUploadArea.tsx` の props に `isOcrAnalyzing`, `onOcrTrigger`, `ocrMessage` を追加
    - プレビュー表示時に「銘柄名を読み取る」ボタンをプレビュー画像の下部に表示
    - 解析中はボタンを無効化し「読み取り中...」+ スピナーを表示
    - 解析中は画像削除ボタンも無効化
    - 画像未選択時は OCR ボタンを非表示
    - 結果メッセージを StatusMessage コンポーネントで表示（success/error variant）
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 5.2 ImageUploadArea OCR 関連のユニットテストを書く
    - `src/features/image/__tests__/ImageUploadArea.ocr.test.tsx` に作成
    - 画像選択時に OCR ボタンが表示されること
    - 画像未選択時に OCR ボタンが非表示であること
    - isOcrAnalyzing=true 時にボタン無効化・ラベル変更・削除ボタン無効化
    - 成功メッセージ・エラーメッセージの表示
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 6. フォーム統合と事前アップロードフロー
  - [x] 6.1 useImageUpload に事前アップロード機能を追加する
    - `src/features/image/hooks/useImageUpload.ts` に画像選択・圧縮完了後の自動 S3 アップロード機能を追加
    - 仮の recordId を使用して事前アップロードし、imageKey を保持
    - フォーム送信時は既にアップロード済みの imageKey を使用
    - _Requirements: 2.4（OCR 実行には S3 上の画像が必要）_

  - [x] 6.2 PurchaseForm に OCR 連携を統合する
    - `src/features/purchase/components/PurchaseForm.tsx` で useOcrAnalysis フックを使用
    - OCR トリガーハンドラ: imageKey を使って analyzeImage を呼び出し
    - OCR 成功時に sakeName フィールドへ自動入力（handleChange('sakeName', result.sakeName)）
    - 既存値がある場合も OCR 結果で上書き
    - OCR 結果反映後も手動編集可能
    - ImageUploadArea に isOcrAnalyzing, onOcrTrigger, ocrMessage を渡す
    - _Requirements: 4.1, 4.3, 4.4, 4.6_

  - [x] 6.3 DrinkingForm に OCR 連携を統合する
    - `src/features/drinking/components/DrinkingForm.tsx` で useOcrAnalysis フックを使用
    - PurchaseForm と同様の OCR 連携ロジックを実装
    - _Requirements: 4.2, 4.3, 4.5, 4.6_

  - [x] 6.4 PurchaseForm OCR 統合のユニットテストを書く
    - OCR 結果が sakeName フィールドに反映されること
    - 既存の sakeName が OCR 結果で上書きされること
    - OCR 結果反映後も sakeName フィールドが編集可能であること
    - _Requirements: 4.1, 4.4, 4.6_

  - [x] 6.5 DrinkingForm OCR 統合のユニットテストを書く
    - OCR 結果が sakeName フィールドに反映されること
    - 既存の sakeName が OCR 結果で上書きされること
    - _Requirements: 4.2, 4.5, 4.6_

- [x] 7. 最終チェックポイント - 全テスト通過確認
  - 全てのテストが通ること、TypeScript の型エラーがないことを確認する。問題があればユーザーに確認する。

## Notes

- `*` 付きのタスクはオプションで、MVP を早く進めるためにスキップ可能
- 各タスクは具体的な要件を参照しトレーサビリティを確保
- チェックポイントでインクリメンタルな検証を実施
- プロパティテストは正当性プロパティの機械的検証を担保
- Lambda は既存の presigned-url Lambda と同じ ESM + createRequire パターンを踏襲
