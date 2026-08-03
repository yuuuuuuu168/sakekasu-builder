# 酒カス (sakekasu-builder.com)

日本酒・ウイスキー・焼酎など、「何を飲んだか」「何を買ったか」を忘れがちな酒飲みのための記録・管理 Web アプリ。

## 機能

| # | 機能 | 状態 |
|---|------|------|
| 1 | 購入したお酒の登録（本数入力対応） | ✅ 実装済み |
| 2 | 飲んだお酒の登録 | ✅ 実装済み |
| 3 | 購入・飲酒記録の一覧表示 | ✅ 実装済み |
| 4 | Cognito 認証 + CDK バックエンド | ✅ 実装済み |
| 5 | 記録の削除 | ✅ 実装済み |
| 6 | 記録の修正（編集）※画像を除くテキスト・メタ情報 | ✅ 実装済み |
| 7 | 画像添付（ラベル写真等） | ✅ 実装済み |
| 8 | 複数画像添付対応 | ✅ 実装済み |
| 9 | 購入記録からの飲酒登録連携 | 未着手 |
| 10 | 購入記録の飲みきりステータス管理 | ✅ 実装済み |
| 11 | 画像からの銘柄名自動取得（AI OCR） | ✅ 実装済み |
| 12 | 写真からおすすめ提案（AI） | 未着手 |
| 13 | 統計ダッシュボード（月別飲酒量・カテゴリ別支出・お気に入りTOP） | ✅ 実装済み ※記録数が少なく実データでの表示確認は未実施 |
| 14 | リピート判定リマインド（購入時に過去評価を表示） | 予定（優先度：高） |
| 15 | 開封後経過日数表示（飲みきりステータスの拡張） | ✅ 実装済み |
| 16 | 価格履歴グラフ（同銘柄の価格推移） | 予定（優先度：中） |
| 17 | カレンダー表示（飲んだ日・買った日を可視化） | 予定（優先度：中） |
| 18 | 検索・フィルタ強化（銘柄名・価格帯・評価・日付範囲） | 予定（優先度：中） |
| 19 | OCR強化（産地・カテゴリ・アルコール度数も抽出） | 予定（優先度：中） |
| 20 | 写真1枚で購入登録（OCR強化の発展形） | 予定（優先度：中） |
| 21 | ウィッシュリスト（買いたい銘柄の記録） | 予定（優先度：低） |
| 22 | AgentCore ソムリエエージェント：対話型機能（在庫相談・ペアリング提案・銘柄レコメンド・酒知識Q&A） | 予定（AgentCore Phase 1） |
| 23 | AgentCore：外部情報連携（新発売・イベント情報収集、Webレビュー要約） | 予定（AgentCore Phase 2） |
| 24 | AgentCore：分析・定期実行（月次振り返りレポート・節酒プランナー・高度なリピート判定） | 予定（AgentCore Phase 3） |

### AgentCore ソムリエエージェント構想

アプリに **「パーソナル酒ソムリエ」AI エージェント** を導入し、単発の AI 呼び出しでは実現できない「記憶・対話・ツール連携」を活用する。

| Phase | 内容 | 使う AgentCore コンポーネント |
|-------|------|----------------------------|
| 1 | 対話 UI + 記録参照（在庫相談・ペアリング・銘柄レコメンド・Q&A） | Runtime + Gateway + Memory |
| 2 | 外部情報収集（新発売情報・レビュー要約） | Browser + Gateway |
| 3 | 定期実行系（月次レポート・節酒プランナー・傾向分析） | Code Interpreter + スケジューラ |

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
