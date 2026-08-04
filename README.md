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
| 9 | 購入記録からの飲酒登録連携（在庫と飲酒記録の紐づけ） | ✅ 実装済み |
| 10 | 購入記録の飲みきりステータス管理 | ✅ 実装済み |
| 11 | 画像からの銘柄名自動取得（AI OCR） | ✅ 実装済み |
| 12 | 写真からおすすめ提案（AI） | 未着手 |
| 13 | 統計ダッシュボード（月別飲酒量・カテゴリ別支出・お気に入りTOP） | ✅ 実装済み ※記録数が少なく実データでの表示確認は未実施 |
| 14 | リピート判定リマインド（購入時に過去評価を表示） | ✅ 実装済み |
| 15 | 開封後経過日数表示（飲みきりステータスの拡張） | ✅ 実装済み |
| 16 | 価格履歴グラフ（同銘柄の価格推移） | 予定（優先度：中） |
| 17 | カレンダー表示（飲んだ日・買った日を可視化） | 予定（優先度：中） |
| 18 | 検索・フィルタ強化（銘柄名・価格帯・評価・日付範囲） | 予定（優先度：中） |
| 19 | OCR強化（産地・カテゴリ・アルコール度数も抽出） | 予定（優先度：中） |
| 20 | 写真1枚で購入登録（OCR強化の発展形） | 予定（優先度：中） |
| 21 | ウィッシュリスト（買いたい銘柄の記録） | 予定（優先度：低） |
| 22 | AgentCore ソムリエエージェント：**在庫相談**（対話型・手持ちから提案） | ✅ 実装済み（Phase 1 MVP） |
| 23 | AgentCore ソムリエ：ペアリング提案・銘柄レコメンド・酒知識Q&A・好み学習 | 予定（Phase 1 の残り） |
| 24 | AgentCore：外部情報連携（新発売・イベント情報収集、Webレビュー要約） | 予定（AgentCore Phase 2） |
| 25 | AgentCore：分析・定期実行（月次振り返りレポート・節酒プランナー・高度なリピート判定） | 予定（AgentCore Phase 3） |
| 26 | 一覧画面の画像表示高速化 | ✅ 実装済み |
| 27 | 一覧画面上部に在庫本数サマリー表示（ウイスキー◯本・日本酒◯本のみ） | ✅ 実装済み |
| 28 | データ保護（DynamoDB PITR・削除保護、S3 バージョニング） | ✅ 実装済み |

### 在庫本数サマリーと在庫連携（#27・#9・完了）

記録一覧の上部に在庫本数を表示し、そこから飲酒記録を登録して「これ飲んでどうだったか」を購入記録側から引けるようにした。

#### 在庫本数サマリー（#27）

- 対象は**ウイスキーと日本酒のみ**。カテゴリごとに本数を出し、飲み中があれば内訳も添える
- 「在庫あり」は**未開封 + 飲み中**（飲みきりは除外）。本数は購入記録の `quantity`（未設定は1本）を合算する
- 本数はステータス単位ではなく記録単位で持つため、1件の購入記録の本数はすべてその記録のステータスとして数える
- フィルタに関係なく全体の在庫を出す。削除やステータス変更をすると即座に追従する（楽観的更新を `useRecordList` 側に集約した）
- 対象カテゴリの在庫が0のときはサマリー自体を表示しない

#### 在庫と飲酒記録の紐づけ（#9）

購入記録カードの「🍶 これを飲む」から飲酒登録へ進み、飲んだ記録が購入記録にぶら下がる。

- `DrinkingRecord` に `purchaseRecordId` を追加（手入力の記録では null）
- 飲酒登録フォームには銘柄名・カテゴリが引き継がれ、飲んだ場所は「自宅」を既定にする
- 登録時、購入記録が**未開封なら自動で「飲み中」**にして開封日時も記録する（飲み中・飲みきりは変更しない）
- 購入記録カードに、紐づいた飲酒記録の**件数・平均評価・最新メモ**を表示する
- フォーム上部のバナーから紐づけを解除できる。解除しても入力内容は消えない

### 画像表示高速化の実装メモ（#26・完了）

一覧のサムネイル表示が遅かったため、以下を実装した（**854MB → 2.8MB / 99.7% 削減**）。

- **サムネイル生成**: アップロード時に長辺 320px の画像を原画の兄弟キー（`thumb_` プレフィックス）として保存。一覧はサムネイルを優先し、無い場合は原画へ自動フォールバック
- **遅延読み込み**: `loading="lazy"` / `decoding="async"`
- **Presigned URL のメモリキャッシュ**: 有効期限内は再利用し、同一キーへの同時リクエストを1本に束ねる
- **既存画像のバックフィル**: `infra/scripts/backfill-thumbnails.py`（EXIF の向きを補正してから縮小する。忘れると写真が横倒しになる）

未着手の案: Presigned URL のバッチ取得（N+1 解消）、CloudFront + OAC でのエッジキャッシュ。

### AgentCore ソムリエエージェント

アプリに **「パーソナル酒ソムリエ」AI エージェント** を導入し、単発の AI 呼び出しでは実現できない「対話・ツール連携」を活用する。

| Phase | 内容 | 状態 |
|-------|------|------|
| 1 | 対話 UI + 記録参照（在庫相談・ペアリング・銘柄レコメンド・Q&A） | 🔵 **在庫相談まで完了**（残りは #23） |
| 2 | 外部情報収集（新発売情報・レビュー要約） | 予定 |
| 3 | 定期実行系（月次レポート・節酒プランナー・傾向分析） | 予定 |

#### Phase 1 MVP（在庫相談）の構成

画面右下の 🍶 ボタンからどのページでも相談でき、手持ちの購入記録をもとに提案が返る。

```
React（右下チャット UI）
  │ Cognito アクセストークンを Bearer で付与
  ▼
AgentCore Runtime（PUBLIC・東京）
  │ ① JWT Authorizer（Cognito・allowedClients で限定）
  │ ② アプリ内の JWKS 検証（署名・exp・iss・audience）
  ▼
Strands Agent（Claude Haiku 4.5 / jp. CRIS）
  │ Tool: list_my_purchase_records
  ▼
DynamoDB（owner-index。トークンの sub で自分の記録のみ）
```

- **モデル**: `jp.anthropic.claude-haiku-4-5-20251001-v1:0`（OCR と共通）
- **会話の継続**: Runtime はステートレス。直近10件の履歴をクライアントから送って文脈を引き継ぐ
- **履歴の保存**: ブラウザの localStorage にユーザー単位で保存（最大50件）。**サインアウト時に削除**
- **入力の安全対策**: プロンプト・履歴・記録の値はすべて正規化（HTML エンティティ展開＋NFKC を固定点まで反復）し、`<user_data>` で囲んで指示と区別。プロンプト長・DynamoDB 読み取りページ数にも上限

#### ソムリエの開発・デプロイ

```bash
# ローカル実行（COGNITO_* は LOCAL_DEV=1 と同時に設定不可）
cd sommelier/app/sommelier
AWS_PROFILE=sakekasu-builder PURCHASE_TABLE_NAME=dev-sakekasu-purchase-records \
  LOCAL_DEV=1 LOCAL_DEV_OWNER_SUB=<Cognitoのsub> uv run main.py
# → POST http://localhost:8080/invocations  {"prompt": "...", "history": []}

# デプロイ
cd sommelier
AWS_PROFILE=sakekasu-builder agentcore deploy --target dev
```

Runtime の ARN はフロントの `src/features/sommelier/config.ts` に持つ（`VITE_SOMMELIER_RUNTIME_ARN` で上書き可）。Runtime を作り直したら更新する。

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
- Amazon Bedrock AgentCore Runtime + Strands Agents（Python）※ソムリエ
- Amazon Bedrock（Claude Haiku 4.5）※OCR・ソムリエ
- Vitest + Testing Library + fast-check

## プロジェクト構成

```
src/
  features/
    auth/        # 認証（Cognito）
    purchase/    # 購入登録
    drinking/    # 飲酒登録
    records/     # 記録一覧
    stats/       # 統計ダッシュボード
    image/       # 画像添付・OCR・サムネイル
    sommelier/   # ソムリエ相談チャット（Runtime 呼び出し）
  components/    # 共通コンポーネント（shadcn/ui, ThemeProvider 等）
infra/
  lib/           # CDK スタック（AuthStack, ApiStack）
  graphql/       # AppSync GraphQL スキーマ
  lambda/        # Lambda 関数（presigned-url, ocr-analyzer）
  scripts/       # amplify_outputs.json 生成、サムネイルのバックフィル
sommelier/       # AgentCore プロジェクト（ソムリエエージェント）
  app/sommelier/ # Strands Agent 本体（Python）
  agentcore/     # AgentCore 設定と CDK
docs/            # 設計ドキュメント
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

「和モダン」コンセプト。ダークモード対応、カスタムカラーパレット（`indigo-wa` / `gold-wa` / `dark-bg` / `dark-gold`。`src/index.css` で定義）。
