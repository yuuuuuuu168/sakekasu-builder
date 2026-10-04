---
inclusion: always
---

# sakekasu-builder.com プロジェクト概要

## サービス概要
酒飲みのための記録・管理Webサイト（sakekasu-builder.com）。日本酒・ウイスキー・焼酎などのバリエーションが多く「何を飲んだか」「何を買ったか」を忘れがちな問題を解決する。

## 計画している機能一覧

| # | 機能 | 状態 | spec |
|---|------|------|------|
| 1 | 購入したお酒を登録するページ | ✅ 実装済み | #[[file:.kiro/specs/sake-purchase-registration/requirements.md]] |
| 2 | 飲んだお酒を登録するページ | ✅ 実装済み | #[[file:.kiro/specs/sake-drinking-registration/requirements.md]] |
| 3 | 購入・飲酒記録の一覧ページ | ✅ 実装済み | #[[file:.kiro/specs/sake-record-list/requirements.md]] |
| 4 | Cognito認証 + CDKバックエンド | ✅ 実装済み | #[[file:.kiro/specs/cdk-backend-auth/requirements.md]] |
| 5 | 記録の削除機能 | ✅ 実装済み | #[[file:.kiro/specs/record-deletion/requirements.md]] |
| 6 | 画像添付機能（ラベル写真等） | ✅ 実装済み | #[[file:.kiro/specs/image-attachment/requirements.md]] |
| 7 | 複数画像添付対応 | 未着手 | - |
| 8 | 購入記録からの飲酒登録連携 | 未着手 | - |
| 9 | 購入記録の飲みきりステータス管理 | 未着手 | - |
| 10 | 画像からの銘柄名自動取得（AI OCR） | ✅ 実装済み | - |
| 11 | 写真からおすすめ提案（AI） | 未着手 | - |

### 機能1: 購入したお酒の登録
- 銘柄名、購入店舗、価格、購入日、カテゴリ、メモを登録
- カテゴリ: 日本酒、ビール、ワイン、ウイスキー、焼酎、その他

### 機能2: 飲んだお酒の登録
- どこで、いくらで、どんな銘柄を飲んだか + 好みの評価を登録

### 機能3: 一覧表示
- 機能1・2の登録内容を一覧で閲覧

### 機能4: おすすめ提案
- 過去の好みデータをもとに、居酒屋メニュー等の写真からおすすめ銘柄を提案

### 機能5: 記録の削除
- 購入記録・飲酒記録を一覧画面から個別に削除できる
- 誤登録や不要な記録の整理に対応

### 機能6: 画像添付
- 購入・飲酒登録時にお酒のラベルや外観の写真を添付できる
- 一覧画面でサムネイル表示
- S3 等のストレージに画像を保存

### 機能7: 複数画像添付対応
- 現在1枚のみの画像添付を複数枚対応に拡張
- 購入・飲酒登録時に複数のラベル写真や外観写真を添付できる
- 一覧画面で複数サムネイルの表示に対応

### 機能8: 購入記録からの飲酒登録連携
- 飲酒登録画面で、過去の購入記録一覧から選択して銘柄名・カテゴリ等を自動入力できる
- 購入したお酒を飲んだときの記録を効率的に登録
- 手入力との併用も可能

### 機能9: 購入記録の飲みきりステータス管理
- 購入記録に「未開封」「飲みかけ」「飲みきり」などのステータスフラグを付与できる
- 一覧画面でステータスを視覚的に確認・フィルタリング可能
- 手持ちのお酒の在庫状況を把握しやすくする

### 機能10: 画像からの銘柄名自動取得
- 添付されたラベル画像から AI（OCR）で銘柄名を自動抽出し、入力フォームに反映
- 登録の手間を軽減

## 技術スタック

- **フレームワーク**: React 19 + TypeScript 5.9
- **ビルドツール**: Vite 7
- **スタイリング**: Tailwind CSS v4（`@theme` ディレクティブ、`@import "tailwindcss"` 方式、tailwind.config.js 不使用）
- **UIコンポーネント**: shadcn/ui（@base-ui/react ベース）
- **アニメーション**: Framer Motion
- **バックエンド**: AWS CDK（AppSync + DynamoDB）、フロントエンドホスティングは Amplify
- **認証**: Amazon Cognito（UserPool）
- **テスト**: Vitest + Testing Library + fast-check（プロパティベーステスト）
- **フォント**: Geist Variable

## プロジェクト構成

```
src/
  features/          # 機能ごとのディレクトリ
    auth/            # 認証機能（Cognito）
    purchase/        # 購入登録機能
    drinking/        # 飲酒登録機能
    records/         # 記録一覧機能
    image/           # 画像添付機能（S3 アップロード・OCR）
      components/    # UI コンポーネント
      hooks/         # カスタムフック
      utils/         # imageCompressor, imageValidator 等
      __tests__/     # テスト（unit + property）
  graphql/           # GraphQL クエリ・ミューテーション定義
  types/             # 共通型定義（schema.ts 等）
  components/        # 共通コンポーネント
    ui/              # shadcn/ui コンポーネント
    ThemeProvider.tsx # ダークモード
    ThemeToggle.tsx   # テーマ切替
  lib/               # ユーティリティ
infra/               # AWS CDK インフラ定義
  lib/               # CDK スタック（ApiStack, MonitoringStack ほか。認証は共通ログイン）
  graphql/           # AppSync GraphQL スキーマ
  lambda/            # Lambda 関数（presigned-url, ocr-analyzer）
  scripts/           # amplify_outputs.json 生成スクリプト等
```

## デザインテーマ
- 「和モダン」コンセプト
- ダークモード対応（next-themes）
- カスタムカラーパレット（sake-gold, sake-red, sake-navy 等）

## 開発ルール
- 新機能は `src/features/{feature-name}/` に配置
- テストは `__tests__/` に unit テストと property テスト（fast-check）を配置
- Amplify のモックは `src/__mocks__/` に配置し、`vite.config.ts` の test.alias で解決
- コンポーネントは shadcn/ui をベースに構築
- 日本語UIを基本とする
