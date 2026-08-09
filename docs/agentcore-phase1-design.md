# AgentCore Phase 1 MVP 設計ドキュメント

## 背景

READMEの機能 #21〜#23 で構想した「パーソナル酒ソムリエ・エージェント」のうち、Phase 1（対話型機能）を実装する。MVP として最小の 1 機能（**在庫相談**）だけ先にリリースし、動作確認後に残りの機能（ペアリング・銘柄レコメンド・酒知識 Q&A）を追加していく。

## 決定事項サマリー

| 項目 | 決定 | 根拠 |
|------|------|------|
| AWS アカウント | `sakekasu-builder`（232791540685） | 既存構成と揃える |
| リージョン | 東京（ap-northeast-1） | Phase 1 全コンポーネントが東京対応確認済み |
| 認証方式 | Cognito JWT Bearer Token（Inbound Auth） | 既存 Cognito UserPool を流用できる |
| フレームワーク | Strands Agents（Python） | AgentCore CLI 推奨・サンプル豊富 |
| 基盤モデル | Claude Haiku 4.5（`jp.anthropic.claude-haiku-4-5-20251001-v1:0`） | 既存 OCR と揃える、コスト最適 |
| CDK 構成 | AgentCore CLI 管理の**独立スタック** | MVP は軽量運用、将来統合可 |
| フロント UI | フローティングボタン（画面右下） | 既存 UI を壊さずどの画面からも呼べる |
| 初期スコープ | 在庫相談のみ | 小さく出して動作確認 |

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│ AWS アカウント: sakekasu-builder (ap-northeast-1)         │
│                                                          │
│  ┌─ CloudFormation Stack: SakekasuInfra (既存) ────┐     │
│  │  Cognito UserPool  AppSync  DynamoDB  Lambda   │     │
│  └────────┬───────────────────────┬────────────────┘     │
│           │                       │                      │
│           │ JWT (Access Token)    │ boto3 Query          │
│           │                       │                      │
│  ┌────────▼─────────────┐  ┌──────▼────────────────┐     │
│  │  AgentCore Runtime   │  │ DynamoDB Tables       │     │
│  │  (新規スタック)       │◀─│ - purchase-records    │     │
│  │                      │  │ - drinking-records    │     │
│  │ - JWT Authorizer     │  └───────────────────────┘     │
│  │ - Strands Agent      │                                │
│  │   (Python + Claude)  │                                │
│  │ - Tool: list_records │                                │
│  └────────▲─────────────┘                                │
└───────────┼──────────────────────────────────────────────┘
            │
            │ HTTPS + Authorization: Bearer <Cognito Access Token>
            │
   ┌────────┴──────────┐
   │ React (Amplify)   │
   │ - 既存画面群       │
   │ - Floating Chat   │ ← 新規追加
   └───────────────────┘
```

### 呼び出しフロー

1. ユーザーが React アプリにログイン（既存 Cognito）→ Access Token 取得
2. ユーザーがフローティングチャットボタンを押下 → 質問入力
3. フロントが `InvokeAgentRuntime` を HTTPS 直叩き（`Authorization: Bearer <AccessToken>`）
4. AgentCore Runtime が JWT Authorizer で Cognito Token を検証
5. Strands Agent が起動、Claude Haiku にユーザー質問を渡す
6. Agent が必要に応じて `list_purchase_records(owner)` Tool を呼び出し
7. Tool が boto3 で DynamoDB を Query（Token の sub をオーナーとして使用）
8. Agent が応答を生成してフロントにストリーミング返却
9. フロントがチャット UI に表示

## MVP スコープ：在庫相談

### ユースケース
> ユーザー「今夜寒いから温めて飲みたい、手持ちで何がおすすめ？」
> エージェント（DynamoDB 参照後）「〇〇が日本酒で温めに向いてそうですよ。前回★4でしたね！」

### Agent が使う Tool（最小）
- `list_my_purchase_records(category?, drinking_status?)` - 自分の購入記録を取得（飲みきり状態でフィルタ可）

### Phase 1 の 2 回目（Issue #51 で実装済み）
- ペアリング提案（料理との相性）
- 似た銘柄レコメンド
- 酒知識 Q&A
- AgentCore Memory 連携（好み学習）

前3つはツールを増やさず、システムプロンプトに相談の型を足して既存の
`list_my_purchase_records` / `list_my_drinking_records` で賄っている。
好み学習だけは `USER_PREFERENCE` ストラテジの Memory リソースを追加した。
現在の構成は README の「AgentCore ソムリエエージェント」を参照。

## 新規追加するもの

### ディレクトリ構成
```
sakekasu.cm/
├─ infra/                          # 既存 CDK（変更なし）
├─ src/                            # React 既存
│   └─ features/
│       └─ sommelier/              # 新規: チャット UI
│           ├─ components/
│           │   ├─ FloatingChatButton.tsx
│           │   └─ ChatWindow.tsx
│           └─ hooks/
│               └─ useAgentInvoke.ts
├─ agent/                          # 新規: AgentCore プロジェクト
│   ├─ agentcore/
│   │   ├─ agentcore.json          # AgentCore CLI 設定
│   │   └─ aws-targets.json
│   └─ app/
│       └─ sommelier/
│           ├─ main.py             # Strands Agent エントリ
│           ├─ tools/
│           │   └─ dynamodb_tool.py
│           └─ pyproject.toml
└─ docs/
    └─ agentcore-phase1-design.md  # このドキュメント
```

### 依存ツール追加
- Node.js 20+（CI / ローカル、既存のはず）
- Python 3.10+（ローカル開発用、未導入なら導入）
- `@aws/agentcore` CLI（npm グローバルインストール）

### IAM 権限
AgentCore Runtime 用 IAM Role に以下を付与：
- `bedrock:InvokeModel`（Claude Haiku 4.5 用）
- `dynamodb:Query` on `PurchaseRecordTable` + `owner-index`
- `logs:*`（CloudWatch、AgentCore が自動設定）

### フロント側の追加
- Amplify から Access Token 取得するヘルパー
- `InvokeAgentRuntime` を SSE ストリーミングで受信するフック
- Runtime エンドポイント URL は `amplify_outputs.json` に追加（手動 or ビルドスクリプト）

## 実装ロードマップ（PR 分割案）

| # | PR 内容 | 目的 |
|---|---------|------|
| 1 | AgentCore CLI プロジェクト scaffold + ローカル動作確認 | 開発環境セットアップ |
| 2 | 在庫相談エージェント実装（DynamoDB Tool 含む）+ ローカル動作確認 | Agent ロジック完成 |
| 3 | Cognito JWT Authorizer 設定 + AgentCore Runtime デプロイ | インフラ完成 |
| 4 | React Floating Chat UI（単体動作） | フロント UI 完成 |
| 5 | フロントから AgentCore Runtime 呼び出し結合 | MVP 完成 |
| 6 | 動作検証後 README・memory 更新 | クローズ |

各 PR は数百行以内を目標に、人間様レビューの負担を最小化。

## オープン質問／リスク

| 項目 | 懸念 | 対応方針 |
|------|------|---------|
| Python ローカル環境 | 人間様の Mac に Python 3.10+ あるか未確認 | PR #1 着手時に `python3 --version` で確認、なければ pyenv 導入 |
| Amplify ビルドへの影響 | `agent/` を Amplify が拾って Python ビルドを試みる可能性 | `amplify.yml` で `agent/` を除外 or プロジェクト直下の `.amplifyignore` を検討 |
| Runtime エンドポイント URL の反映 | デプロイ後の URL を `amplify_outputs.json` に反映する仕組みなし | 簡易的にはデプロイ後に手動追記、将来スクリプト化 |
| CORS 設定 | React（`*.amplifyapp.com` / `sakekasu-builder.com`）から Runtime を叩ける必要 | JWT auth + HTTPS 直叩きなので AgentCore Runtime 側の CORS 設定確認が必要 |
| 料金 | AgentCore Runtime の待機料金・Claude 呼び出し料金 | MVP 期は開発環境のみ、月数ドル想定。動作確認後に本番用設計 |

## 参考資料

- [Get started with Amazon Bedrock AgentCore (CLI)](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-get-started-cli.html)
- [Authenticate with Inbound Auth and Outbound Auth](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-oauth.html)
- [Supported AWS Regions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-regions.html)
- [AgentCore code samples (GitHub)](https://github.com/awslabs/amazon-bedrock-agentcore-samples)

## 次のステップ

このドキュメントがマージされたら、実装ロードマップの PR #1（AgentCore CLI scaffold）から着手する。
