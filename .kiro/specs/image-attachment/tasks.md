# 実装計画: 画像添付機能

## 概要

購入登録・飲酒登録フォームに画像添付機能を追加する。インフラ（S3・Lambda）→ ユーティリティ → コンポーネント → 既存画面への統合の順にインクリメンタルに実装する。

## タスク

- [x] 1. GraphQLスキーマ拡張と型定義の更新
  - [x] 1.1 GraphQLスキーマにimageKey フィールドとPresigned URL関連の型・ミューテーション・クエリを追加する
    - `infra/graphql/schema.graphql` に PurchaseRecord / DrinkingRecord の imageKey フィールドを追加
    - CreatePurchaseRecordInput / CreateDrinkingRecordInput に imageKey フィールドを追加
    - PresignedUrlResponse 型、generateUploadUrl ミューテーション、getDownloadUrl クエリを追加
    - _要件: 7.1, 7.2, 7.3, 7.4, 6.1, 6.2_
  - [x] 1.2 TypeScript型定義を更新する
    - `src/types/schema.ts` の PurchaseRecordType / DrinkingRecordType に `imageKey: string | null` を追加
    - `src/features/records/types.ts` の UnifiedRecord に `imageKey?: string | null` を追加
    - _要件: 7.1, 7.2, 7.5_
  - [x] 1.3 GraphQLクエリ・ミューテーション定義を追加する
    - `src/graphql/` に generateUploadUrl ミューテーションと getDownloadUrl クエリの定義を追加
    - 既存の createPurchaseRecord / createDrinkingRecord ミューテーションに imageKey を追加
    - _要件: 6.1, 6.2, 3.3, 3.4_

- [x] 2. S3バケットとPresigned URL Lambdaのインフラ構築
  - [x] 2.1 S3バケットをCDK ApiStackに追加する
    - `infra/lib/api-stack.ts` に S3 バケット定義を追加
    - パブリックアクセスブロック、SSE-S3暗号化、CORS設定、RemovalPolicy を設定
    - _要件: 5.1, 5.2, 5.3, 5.5, 5.6_
  - [x] 2.2 Presigned URL生成Lambda関数を実装する
    - `infra/lambda/presigned-url/index.ts` を作成
    - generateUploadUrl: アップロード用Presigned URL生成（有効期限300秒、Content-Type制限）
    - getDownloadUrl: ダウンロード用Presigned URL生成（有効期限3600秒）
    - Cognitoユーザーのsubをキープレフィックスに使用してアクセス制御
    - _要件: 6.3, 6.4, 6.5, 6.6, 6.7, 5.4_
  - [x] 2.3 AppSync Lambda データソースとリゾルバーを設定する
    - ApiStack に Lambda データソースを追加
    - generateUploadUrl ミューテーションと getDownloadUrl クエリのリゾルバーを作成
    - Lambda に S3 読み書き権限を付与
    - _要件: 6.1, 6.2, 6.7_

- [x] 3. チェックポイント - インフラ構成の確認
  - すべてのCDKコードがコンパイルエラーなく通ることを確認し、ユーザーに質問があれば確認する。

- [x] 4. 画像バリデーション・圧縮ユーティリティの実装
  - [x] 4.1 ImageValidator ユーティリティを実装する
    - `src/features/image/utils/imageValidator.ts` を作成
    - JPEG / PNG のみ許可するファイル形式バリデーション
    - エラーメッセージ「JPEG または PNG 形式の画像を選択してください」を返す
    - _要件: 2.1, 2.2, 2.3_
  - [x] 4.2 ImageValidator のプロパティテストを作成する
    - **プロパティ 1: JPEG/PNGファイルは常にバリデーション成功する**
    - **検証対象: 要件 2.1**
    - `src/features/image/__tests__/imageValidator.property.test.ts` を作成
  - [x] 4.3 ImageCompressor ユーティリティを実装する
    - `src/features/image/utils/imageCompressor.ts` を作成
    - 5MB以下のファイルはそのまま返す
    - 5MB超のファイルは Canvas API で品質を段階的に下げて圧縮
    - 品質最低でも5MB以下にならない場合は解像度を縮小
    - 圧縮後はJPEG形式で出力
    - 圧縮失敗時はエラーをスロー
    - _要件: 2.4, 2.7, 2.8, 2.9, 2.10_
  - [x] 4.4 ImageCompressor のユニットテストを作成する
    - 5MB以下のファイルが圧縮されないことをテスト
    - 圧縮結果が5MB以下であることをテスト
    - `src/features/image/__tests__/imageCompressor.test.ts` を作成
    - _要件: 2.4, 2.7_

- [x] 5. 画像アップロード・ダウンロードフックの実装
  - [x] 5.1 useImageUpload フックを実装する
    - `src/features/image/hooks/useImageUpload.ts` を作成
    - handleImageSelect: バリデーション → 圧縮 → プレビュー設定
    - uploadImage: generateUploadUrl ミューテーション呼び出し → S3 PUT → imageKey 返却
    - isCompressing / isUploading / error の状態管理
    - clearImage でリセット
    - _要件: 1.6, 2.4, 2.5, 2.6, 3.1, 3.2, 3.7, 3.8, 3.9_
  - [x] 5.2 useImageUrl フックを実装する
    - `src/features/image/hooks/useImageUrl.ts` を作成
    - imageKey を受け取り getDownloadUrl クエリで Presigned URL を取得
    - isLoading / hasError の状態管理
    - imageKey が null の場合は URL 取得をスキップ
    - _要件: 4.1, 4.4, 4.5_

- [x] 6. 画像UIコンポーネントの実装
  - [x] 6.1 ImageUploadArea コンポーネントを実装する
    - `src/features/image/components/ImageUploadArea.tsx` を作成
    - ファイル選択ボタンとドラッグ＆ドロップ領域
    - 「画像を選択またはドラッグ＆ドロップ」案内テキスト
    - プレビュー表示（サムネイルサイズ）と削除ボタン（×アイコン）
    - 圧縮中メッセージ「画像を圧縮中...」
    - 圧縮完了通知「画像を圧縮しました（元: {元サイズ}MB → {圧縮後サイズ}MB）」
    - アップロード進捗プログレスインジケーター
    - エラーメッセージ表示
    - _要件: 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.3, 2.5, 2.6, 2.10, 3.7_
  - [x] 6.2 ImageModal コンポーネントを実装する
    - `src/features/image/components/ImageModal.tsx` を作成
    - Framer Motion でアニメーション付きモーダル
    - 元サイズの画像を表示
    - 閉じるボタンとオーバーレイクリックで閉じる
    - _要件: 4.6_
  - [x] 6.3 ImageUploadArea のユニットテストを作成する
    - ファイル選択・ドラッグ＆ドロップ・プレビュー表示・削除ボタンのテスト
    - `src/features/image/__tests__/ImageUploadArea.test.tsx` を作成
    - _要件: 1.3, 1.6, 1.7, 1.8_

- [x] 7. チェックポイント - ユーティリティとコンポーネントの確認
  - すべてのテストが通ることを確認し、ユーザーに質問があれば確認する。

- [x] 8. 購入登録・飲酒登録フォームへの統合
  - [x] 8.1 PurchaseForm に画像アップロード機能を統合する
    - PurchaseForm に ImageUploadArea と useImageUpload を組み込む
    - 登録処理: Presigned URL 取得 → S3 PUT → imageKey 付きで createPurchaseRecord 実行
    - 画像なしの場合は imageKey を null として保存
    - アップロード失敗時のエラーメッセージ表示と入力内容保持
    - _要件: 1.1, 3.1, 3.3, 3.5, 3.8_
  - [x] 8.2 DrinkingForm に画像アップロード機能を統合する
    - DrinkingForm に ImageUploadArea と useImageUpload を組み込む
    - 登録処理: Presigned URL 取得 → S3 PUT → imageKey 付きで createDrinkingRecord 実行
    - 画像なしの場合は imageKey を null として保存
    - アップロード失敗時のエラーメッセージ表示と入力内容保持
    - _要件: 1.2, 3.2, 3.4, 3.6, 3.9_

- [x] 9. 一覧画面でのサムネイル表示と画像モーダルの統合
  - [x] 9.1 RecordCard にサムネイル表示を追加する
    - imageKey がある場合: useImageUrl で Presigned URL を取得し 80×80px サムネイル表示（object-fit: cover）
    - imageKey が null の場合: プレースホルダーアイコン表示
    - 読み込み中: スケルトンローダー表示
    - 読み込み失敗: プレースホルダーアイコンにフォールバック
    - サムネイルクリックで ImageModal を開く
    - _要件: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [x] 9.2 RecordListPage に ImageModal の状態管理を追加する
    - 選択された画像の URL と銘柄名を管理
    - ImageModal コンポーネントを配置
    - _要件: 4.6_

- [x] 10. 記録削除時の画像削除連動
  - [x] 10.1 削除リゾルバーをPipelineリゾルバーに変更し画像削除を連動させる
    - 既存の deleteRecord リゾルバーを Pipeline リゾルバーに変更
    - ステップ1: DynamoDB から記録取得（imageKey含む）→ 削除
    - ステップ2: imageKey が存在する場合、Lambda 経由で S3 画像削除
    - imageKey が null の場合は画像削除をスキップ
    - 画像削除失敗時は記録削除は成功扱い、エラーをログ記録
    - Lambda に S3 削除権限を追加
    - _要件: 8.1, 8.2, 8.3, 8.4_

- [x] 11. 最終チェックポイント - 全テスト実行と動作確認
  - すべてのテストが通ることを確認し、ユーザーに質問があれば確認する。

## 備考

- `*` 付きのタスクはオプションであり、MVP では省略可能
- 各タスクは具体的な要件番号を参照しトレーサビリティを確保
- チェックポイントでインクリメンタルに検証を実施
- プロパティテストは fast-check を使用して普遍的な正しさを検証
- ユニットテストは具体的な例とエッジケースを検証
