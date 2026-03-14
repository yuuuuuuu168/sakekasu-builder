# 酒カス (sakekasu-builder.com)

日本酒・ウイスキー・焼酎など、「何を飲んだか」「何を買ったか」を忘れがちな酒飲みのための記録・管理 Web アプリ。

## 機能

| # | 機能 | 状態 |
|---|------|------|
| 1 | 購入したお酒の登録 | ✅ 実装済み |
| 2 | 飲んだお酒の登録 | ✅ 実装済み |
| 3 | 購入・飲酒記録の一覧表示 | ✅ 実装済み |
| 4 | Cognito 認証 + CDK バックエンド | ✅ 実装済み |
| 5 | 記録の削除 | ✅ 実装済み |
| 6 | 画像添付（ラベル写真等） | ✅ 実装済み |
| 7 | 複数画像添付対応 | 未着手 |
| 8 | 購入記録からの飲酒登録連携 | 未着手 |
| 9 | 購入記録の飲みきりステータス管理 | 未着手 |
| 10 | 画像からの銘柄名自動取得（AI OCR） | ✅ 実装済み |
| 11 | 写真からおすすめ提案（AI） | 未着手 |

## 技術スタック

- React 19 + TypeScript 5.9
- Vite 7
- Tailwind CSS v4
- shadcn/ui（@base-ui/react ベース）
- Framer Motion
- AWS CDK（AppSync + DynamoDB）
- Amazon Cognito（UserPool）
- AWS S3（画像ストレージ）
- Amplify（フロントエンドホスティング）
- Vitest + Testing Library + fast-check

## プロジェクト構成

```
src/
  features/
    auth/        # 認証（Cognito）
    purchase/    # 購入登録
    drinking/    # 飲酒登録
    records/     # 記録一覧
    image/       # 画像添付・OCR
  components/    # 共通コンポーネント（shadcn/ui, ThemeProvider 等）
infra/
  lib/           # CDK スタック（AuthStack, ApiStack）
  graphql/       # AppSync GraphQL スキーマ
  lambda/        # Lambda 関数（presigned-url, ocr-analyzer）
  scripts/       # amplify_outputs.json 生成スクリプト
```

## セットアップ

```bash
# フロントエンド
npm install
npm run dev

# インフラ（CDK）
cd infra
npm install
npx cdk deploy --context env=dev
```

デプロイ後、`infra/scripts/generate-outputs.ts` を実行して `amplify_outputs.json` を生成してください。

## テスト

```bash
# フロントエンド
npm run test -- --run

# インフラ
cd infra
npm run test -- --run
```

## デザイン

「和モダン」コンセプト。ダークモード対応、カスタムカラーパレット（sake-gold, sake-red, sake-navy 等）。
