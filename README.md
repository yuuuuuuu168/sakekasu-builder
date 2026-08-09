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
| 18 | 検索・フィルタ強化（キーワード横断検索・評価フィルタ・絞り込み条件の保持・表記ゆれ吸収） | ✅ 実装済み ※価格帯・日付範囲は未対応（Issue #47） |
| 19 | OCR強化（産地・カテゴリ・アルコール度数も抽出） | ✅ 実装済み |
| 20 | 写真1枚で購入登録（OCR強化の発展形） | ✅ 実装済み ※画像選択で自動OCR実行。価格・店名は手入力（Issue #49） |
| 21 | ウィッシュリスト（買いたい銘柄の記録） | 予定（優先度：低） |
| 22 | AgentCore ソムリエエージェント：**在庫相談**（対話型・手持ちから提案） | ✅ 実装済み（Phase 1 MVP） |
| 23 | AgentCore ソムリエ：ペアリング提案・銘柄レコメンド・酒知識Q&A・好み学習 | 予定（Phase 1 の残り） |
| 24 | AgentCore：外部情報連携（新発売・イベント情報収集、Webレビュー要約） | 予定（AgentCore Phase 2） |
| 25 | AgentCore：分析・定期実行（月次振り返りレポート・節酒プランナー・高度なリピート判定） | 予定（AgentCore Phase 3） |
| 26 | 一覧画面の画像表示高速化 | ✅ 実装済み |
| 27 | 一覧画面上部に在庫本数サマリー表示（ウイスキー◯本・日本酒◯本のみ） | ✅ 実装済み |
| 28 | データ保護（DynamoDB PITR・削除保護、S3 バージョニング） | ✅ 実装済み |
| 29 | 監視とアラート通知（AI・サービス正常性・外形監視・AWS Health → Slack） | ✅ 実装済み ※デプロイ前に手動登録あり |
| 30 | 新規ユーザー登録の Slack 通知（Cognito Post Confirmation → SNS） | ✅ 実装済み（Issue #66） |
| 31 | 毎日の AWS 利用料金 Slack 通知（組織合計・上位サービス内訳・クレジット込み） | ✅ 実装済み（Issue #92）※管理アカウントへデプロイ |
| 32 | DevOps Agent による自動インシデント調査（アラーム → 調査 → Slack） | ✅ 実装済み（Issue #67）※コンソール側の設定あり |

### 検索・フィルタ強化（#18・完了）

記録が増えても目当ての1本に辿り着けるよう、一覧の絞り込みを広げた。バックエンドの変更はなく、フロントのみで完結する。

- **キーワード横断検索**: 酒名だけでなく、店名・場所名・飲み方・メモも検索対象にした。酒名は従来どおり曖昧検索（各文字が順番に出現すればヒット）で、うろ覚えや部分入力から辿れる。それ以外の項目は部分一致にしている。メモまで曖昧検索にすると、離れた位置の文字が拾われて無関係な記録が大量に混ざるため
- **表記ゆれの吸収**: 「アラン」「あらん」「ｱﾗﾝ」「Allan」「Arran」のどれで打っても同じ記録に辿り着く（詳細は下記）
- **評価フィルタ**: 「★4以上」のように星数のしきい値で絞る。評価を持つのは飲酒記録だけなので、選ぶと記録種別も自動で飲酒記録に切り替わる（飲みきりステータスを選ぶと購入記録に切り替わるのと同じ挙動）
- **絞り込み条件の保持**: 選んだ条件を localStorage に保存し、タブを移動して戻っても復元する。記録一覧はタブ切り替えでアンマウントされるため、以前は毎回絞り込み直しだった
  - 保存先は**ユーザーごとに分ける**（`sakekasu:record-filters:<userId>`）。検索語には銘柄名が残るため、サインアウト時にはソムリエの相談履歴と同じく削除する
  - 選択肢に無い値が保存されていた場合は、項目ごとに既定値へ落として復元する

実装は `src/features/records/hooks/useRecordFilter.ts`（判定ロジック）と `lib/filterStorage.ts`（保存・復元）。条件が5つに増えたため、`filterRecords` の引数は位置引数から `RecordFilters` オブジェクトに変えた。

#### 表記ゆれの吸収（#39・完了）

同じ銘柄でもカタカナで書いたり英字で書いたりするため、**見た目を揃えた比較**と**音に変換した比較**の2段で突き合わせる（`lib/searchNormalize.ts`）。

```
「アラン」 → ローマ字化 → aran
「Allan」  → 重複子音を畳む → alan → l と r を同一視 → aran
「Arran」  → rr を畳む → aran
```

| 揺れの種類 | 例 | 対応 |
|-----------|----|----|
| ひらがな / カタカナ / 半角カナ | あらん・アラン・ｱﾗﾝ | NFKC 正規化＋かな統一 |
| 全角 / 半角、大文字 / 小文字 | ＡＲＲＡＮ・arran | NFKC 正規化 |
| カナ / アルファベット | アラン・Allan・Arran | ローマ字に変換して比較 |
| l と r、b と v、重複子音、長音 | Allan / Arran、ヴォッカ / ボッカ | 同一視して畳む |

**対応しないもの**: 漢字と読みの対応（獺祭 / だっさい。読みの辞書が必要）、音そのものがずれる借用語（ビール / Beer）。

音による比較は**部分一致に留めている**。ここに曖昧検索を掛けると、母音を落とした短いキー同士が偶然一致して無関係な記録が混ざるため。実際に「母音を落として子音の骨組みで比較する」案も試したが、「カク」と「コク」、「アサヒ」と「アシ」が衝突したため採用しなかった。

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

#### 失敗したときの切り分け

以前はどんな失敗でも「応答の取得に失敗しました」の一文だったため、画面からもログからも原因を絞れなかった。いまは失敗を4種類に分けて扱う（`src/features/sommelier/lib/errors.ts`）。

| 種類 | 画面の文言 | 主な原因 |
|------|-----------|---------|
| `auth` | サインインの有効期限が切れたかも〜 | トークンの取得・更新に失敗、Runtime が 401/403 を返した |
| `network` | 通信に失敗しました〜 | fetch が届かなかった（接続断・CORS 拒否など）、受信途中で切れた |
| `server` | ソムリエが応答できませんでした（HTTP xxx）〜 | Runtime までは届いたが 5xx、またはエージェントがエラーを返した |
| `unknown` | 応答の取得に失敗しました〜 | 上記以外 |

ブラウザのコンソールには `ソムリエへの問い合わせに失敗しました [種類]:` の形で種類が出る。停止ボタンによる中断はエラー扱いせず、受信済みの内容を残して静かに終わる。

Runtime まで届いていたかどうかは、CloudWatch Logs でも確認できる。

```bash
AWS_PROFILE=sakekasu-builder aws logs tail \
  /aws/bedrock-agentcore/runtimes/sommelier_sommelier-Cn5eM865GE-DEFAULT \
  --since 1h --region ap-northeast-1
```

アイドル15分で実行環境が落ちるため、久しぶりの呼び出しは必ず起動ログから始まる。**起動ログすら無ければ、リクエストが Runtime に到達していない**（＝ `auth` か `network`）と判断できる。

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

## 監視とアラート通知（#29）

異常を人間が気づく前に Slack へ流す。きっかけは、ソムリエが数時間おかしくなったのに気づけず、原因の切り分けにも時間がかかったこと。

```
CloudWatch アラーム ─┐
外形監視 Lambda ─────┤
カナリア Lambda ─────┼→ SNS → Slack 通知 Lambda → Slack（Incoming Webhook）
AWS Health ──────────┤
（EventBridge 経由）  │
新規登録通知 Lambda ─┘
（Cognito トリガー）
```

アラームは**発報だけでなく復旧も通知する**ので、鳴りっぱなしなのか直ったのかが Slack だけで分かる。

### 監視項目（22アラーム）

| 分類 | 監視対象 | 発報条件 |
|------|---------|---------|
| AI・ソムリエ | 認証拒否（`InboundAuthorizationFailure`） | 5分で3回以上。例外の種類ごとに分けて監視 |
| AI・ソムリエ | システムエラー / スロットル | 5分で1回以上 |
| AI・OCR | Lambda エラー | 15分で3回以上 |
| AI・OCR | スロットル | 15分で1回以上 |
| サービス | AppSync 5XX | 5分で5回以上 |
| サービス | Lambda エラー（presigned-url / ocr-analyzer） | 15分で5回以上 |
| サービス | DynamoDB スロットル（2テーブル） | 5分で1回以上 |
| サービス | 画像削除の失敗 | 1時間で5回以上 |
| 外形監視 | フロント配信 / ソムリエ Runtime / AppSync | 2回続けて到達不可 |
| 外形監視 | ソムリエとの実会話（カナリア） | 失敗したら即時 |
| 通知経路 | Slack 通知 Lambda のエラー | 1回以上 |
| 通知経路 | 新規登録通知の送信失敗（`SignupNotifyFailCount`） | 5分で1回以上 |
| 監視自体 | 外形監視・カナリアの実行失敗 | 1回以上 |
| 監視自体 | 外形監視・カナリアが動いていない | 実行回数が0（外形監視は1時間、カナリアは12時間） |
| AWS 側 | AWS Health の障害・予定された変更 | イベントが届いたら即時（アラームではなく EventBridge 経由） |

監視そのものが動かなくなると異常に気づけないため、**Slack 通知 Lambda と外形監視・カナリアも監視対象**に含めている。「エラーで失敗した」だけでなく「**そもそも動いていない**」も見る。スケジュールが止まるとエラーすら記録されず、静かに監視が消えるため。

既定では「データが無い＝異常なし」として扱うが、欠損そのものに意味がある指標は例外にしている。

- **カナリア**: `MISSING`（状態を保持）。6時間に1度しか計測しないため、既定のままだと直っていないのに次の計測を待つ間に復旧扱いになる
- **実行回数の監視**: `BREACHING`（欠損は異常）。記録が無いことが「動いていない」ことを意味するため

**認証拒否の監視が今回の障害への直接の答え**。実際に障害当時のメトリクスを確認したところ、`UnauthorizedInboundTokenException` が3回記録されていた。これを監視していれば即座に気づけた。

### AWS 側の障害・メンテナンス（AWS Health）

自分たちのコードでは直せない事象（サービス障害、EC2 の再起動予定、証明書の期限、サービス廃止の予告など）を、気づく前に受け取る。

```
[us-east-1]        Health ルール ──転送──┐
                                          ▼
[ap-northeast-1]   Health ルール → SNS（既存）→ Slack 通知 Lambda → Slack
```

**グローバルサービス（IAM・CloudFront・Route 53 など）のイベントは us-east-1 にしか届かない。** また EventBridge のターゲットは同一リージョンに限られるため、us-east-1 側は「東京のイベントバスへ転送する」だけを行う（`infra/lib/health-global-stack.ts`）。転送されたイベントも同じ形で東京のバスに入るので、**受け口のルールは東京側の1本で済む**。

通知するのは `issue`（実際の障害）と `scheduledChange`（予定された変更）のみ。`accountNotification`（お知らせ）や `investigation`（調査中）まで拾うと日常的に鳴ってノイズになるため、あえて絞っている。

Slack には日本語の見出しを付け、対象サービス・種類・リージョン・開始/終了時刻（JST）・**影響を受けるリソース**を出す。本文は英語で長くなりがちなので冒頭のみ載せ、詳細は AWS Health Dashboard へ誘導する。

なお **Basic サポートプランでは AWS にテストイベントを発行してもらえない**（Business+ 以上が必要）。また `aws.` で始まるイベントソースは AWS の予約で、自前で `put-events` することもできない（`NotAuthorizedForSourceException` になる）。

そのため実機での確認は、**Slack 通知 Lambda を直接呼んで見え方を確かめる**方法をとる。ルールのイベントパターン自体は CDK のテストで固定している。

```bash
# Health イベント形式の SNS メッセージを Lambda に渡す
AWS_PROFILE=sakekasu-builder aws lambda invoke \
  --function-name dev-sakekasu-slack-notifier \
  --payload file://event.json --cli-binary-format raw-in-base64-out \
  --region ap-northeast-1 /dev/stdout
```

### 新規ユーザー登録の通知（#30）

誰かがサインアップして確認を終えると、Cognito の Post Confirmation トリガーが通知 Lambda（`infra/lambda/signup-notifier/`）を呼び、既存のアラートトピック経由で Slack に「メールアドレス・登録時刻（JST）・ユーザープール」を流す。パスワード再設定の確認でも同じトリガーが呼ばれるため、`triggerSource` でサインアップ確認だけに絞っている。

設計上の注意は2点。

- **通知 Lambda は決して throw しない**。Post Confirmation トリガーの失敗はサインアップの確認そのものをエラーにしてしまうため、SNS 送信の失敗は握りつぶしてログに残す。Cognito がトリガーの完了を5秒しか待たず、その5秒にはコールドスタートも含まれる点を踏まえ、送信は1.5秒で打ち切る。握りつぶした失敗は `SignupNotifyFailCount` メトリクス経由のアラームで拾う
- **アラートトピックは名前規約で参照する**。トピックを作る監視スタックは AuthStack に依存済みのため、オブジェクト参照で受け取ると循環参照になる（画像削除アラームと同じ構図）

### 外形監視の考え方

到達性の確認（5分ごと）は、**認証情報を持たずに**行う。ソムリエ Runtime と AppSync はあえて認証なしで叩き、**401/403 が返ることを正常**とみなす。これで「エンドポイントが生きている」ことと「認証が働いている」ことを、監視側に鍵を持たせずに確認できる。

実際に会話できるかはカナリア（6時間ごと）が見る。こちらは監視用ユーザーでサインインして短い相談を投げ、応答が返るまでを確認する。毎回 LLM を呼ぶため頻度を抑えている。

### デプロイ前の準備

Webhook URL と監視ユーザーのパスワードはリポジトリに置けないため、**先に手動で登録**する。CDK は名前で参照するだけ。

```bash
# 1. Slack の Incoming Webhook URL を登録する
AWS_PROFILE=sakekasu-builder aws ssm put-parameter \
  --name /dev-sakekasu/monitoring/slack-webhook-url \
  --type SecureString \
  --value 'https://hooks.slack.com/services/XXX/YYY/ZZZ' \
  --region ap-northeast-1

# 2. カナリア用の Cognito ユーザーを作る（パスワードは自分で決める）
AWS_PROFILE=sakekasu-builder aws cognito-idp admin-create-user \
  --user-pool-id ap-northeast-1_eZOfInCT4 \
  --username canary@example.com \
  --message-action SUPPRESS \
  --region ap-northeast-1
AWS_PROFILE=sakekasu-builder aws cognito-idp admin-set-user-password \
  --user-pool-id ap-northeast-1_eZOfInCT4 \
  --username canary@example.com \
  --password '<決めたパスワード>' --permanent \
  --region ap-northeast-1

# 3. その認証情報を Secrets Manager に入れる
AWS_PROFILE=sakekasu-builder aws secretsmanager create-secret \
  --name dev-sakekasu/monitoring/canary-user \
  --secret-string '{"username":"canary@example.com","password":"<決めたパスワード>"}' \
  --region ap-northeast-1

# 4. デプロイ（AWS Health 用に us-east-1 のスタックも含まれる）
cd infra
AWS_PROFILE=sakekasu-builder npx cdk deploy --all -c env=dev

# 5. 出力された CanaryUserPoolClientId を控え、agentcore.json を2箇所直してから
#    ソムリエを再デプロイする（下の「カナリアを通すための2箇所」を参照）
cd ../sommelier
AWS_PROFILE=sakekasu-builder agentcore deploy --target dev
```

カナリアがサインインするため、**専用の UserPoolClient**（`<env>-sakekasu-canary-client`）を用意している。ブラウザ向けクライアントは SRP のみのままにし、管理者パスワード認証はカナリア専用クライアントだけに持たせる。同じクライアントに両方を持たせると、IAM の足がかりを得た相手が任意の利用者になりすませる余地が広がるため。

カナリア用クライアントは `ADMIN_USER_PASSWORD_AUTH` のみで SRP を持たない。このフローは IAM 認証済みの呼び出し元（＝カナリアの Lambda ロール）からしか使えず、ブラウザからは利用できない。

#### カナリアを通すための2箇所（どちらか一方だけでは 403 になる）

ソムリエの認証は**二段構え**（Runtime の JWT Authorizer + アプリ内の audience 検証）なので、`sommelier/agentcore/agentcore.json` を**2箇所**直す。

```json
// ① Runtime の JWT Authorizer が受け付けるクライアント
"allowedClients": ["3a4unc2dbutrkm2hjn887s1h9m", "<CanaryUserPoolClientId>"]

// ② アプリ内の audience 検証が受け付けるクライアント（カンマ区切り）
{ "name": "COGNITO_APP_CLIENT_ID", "value": "3a4unc2dbutrkm2hjn887s1h9m,<CanaryUserPoolClientId>" }
```

①だけ直すとゲートウェイは通るがアプリ内検証で弾かれる。カナリアが `HTTP 403` を返したときは、まずこの2箇所を疑う（カナリアのログとアラーム本文にもその旨を出している）。

Runtime の ARN とサイト URL は CDK コンテキストで差し替えられる。

```bash
npx cdk deploy sakekasu-dev-monitoring -c env=dev \
  -c sommelierRuntimeArn=arn:aws:bedrock-agentcore:... \
  -c siteUrl=https://example.com
```

### 費用の目安

概算で**月5ドル前後**。内訳は CloudWatch アラーム21件（$0.10/件）とカスタムメトリクス8種（$0.30/種）が大半で、Lambda・SNS は無料枠にほぼ収まる。カナリアの Bedrock 呼び出しは月120回・短い応答のため数円程度。

## 毎日の利用料金 Slack 通知（#92）

AWS の利用料金を毎日 09:05 JST に Slack へ通知する。**組織全体の合計 → sakekasu-builder** の順で表示し、実際に請求される額だけでなく**クレジットで賄われた分**も載せる（クレジット適用前の利用額・クレジット適用額・請求見込みの3点）。それぞれに**サービス別内訳**（今月・クレジット適用前・Tax は集計から除外）を実サービス名で上位5位まで添え、6位以下は「その他」に合算する。組織全体の合計は全アカウント分を足すため、個別表示していないアカウントの費用も漏れない。

```
EventBridge（毎日 00:05 UTC）→ billing-notifier Lambda → Cost Explorer API
                                        └→ Slack Incoming Webhook
```

### 他のスタックとの違い

アカウント別の内訳（`LINKED_ACCOUNT`）を Cost Explorer で見られるのは **Organization の管理アカウントだけ**のため、このスタック（`sakekasu-billing-notifier`）は他と違い**管理アカウント（<管理アカウント ID>）へデプロイする**。環境（dev/staging/prod）にも紐づかない単一のスタックで、通常の `cdk deploy --all` に混ざらないよう `-c billing=true` を付けたときだけ合成される。

対象アカウントの一覧（表示ラベル含む）は `infra/bin/app.ts` の `targetAccounts` で変更できる。

### 監視

レポートが止まっても気づけるよう、3つのアラーム（レポート Lambda の失敗・1日以上の沈黙・Slack 通知の失敗）を同じスタック内に持つ。通知経路は監視スタック（#29）と同じ Slack 通知 Lambda の実装を再利用している。

### デプロイ手順（管理アカウント）

```bash
# 1. 管理アカウントの認証情報で入っていることを確認する
AWS_PROFILE=yuuuuuuuki7749 aws sts get-caller-identity

# 2. （初回のみ）管理アカウントを CDK bootstrap する
cd infra
AWS_PROFILE=yuuuuuuuki7749 npx cdk bootstrap aws://<管理アカウント ID>/ap-northeast-1 -c billing=true

# 3. Slack の Incoming Webhook URL を管理アカウント側に登録する
AWS_PROFILE=yuuuuuuuki7749 aws ssm put-parameter \
  --name /sakekasu-billing/slack-webhook-url \
  --type SecureString \
  --value 'https://hooks.slack.com/services/XXX/YYY/ZZZ' \
  --region ap-northeast-1

# 4. デプロイ
AWS_PROFILE=yuuuuuuuki7749 npx cdk deploy sakekasu-billing-notifier -c billing=true

# 5. 動作確認（手動で1回実行して Slack に届くか見る）
AWS_PROFILE=yuuuuuuuki7749 aws lambda invoke \
  --function-name sakekasu-billing-notifier \
  --region ap-northeast-1 /dev/stdout
```

数値は Cost Explorer の集計途中の概算（UTC 日単位）で、確定額は請求書と一致しないことがある。月初日の実行では「今月累計」が空になるため、前月まるごとを「確定」として通知する。Cost Explorer API は 1 リクエスト $0.01 で、1日3回の呼び出し（アカウント別の今月・昨日、サービス別の今月）なので**月1ドル前後**。

## DevOps Agent による自動インシデント調査（#67）

アラームが鳴ってから調べ始めるまでの時間をなくすため、CloudWatch アラームの発報をそのまま AWS DevOps Agent に渡して調査を始めさせる。エージェントがテレメトリ・ログ・デプロイ履歴を突き合わせ、根本原因と緩和策を専用の Slack チャンネルに投稿する。

```
SNS（dev-sakekasu-alerts）┬→ Slack 通知 Lambda → Slack（既存のアラートチャンネル）
                          └→ 転送 Lambda → DevOps Agent Webhook → 自動調査 → Slack（専用チャンネル）
```

既存の Slack 通知は変えていない。転送 Lambda は同じトピックをもう1つの購読者として受け取るだけなので、エージェント側が止まってもアラート自体は届く。

Agent Space は運用ツール専用アカウント（`<運用アカウント ID>` / `ops-tooling`）に置き、調査対象はアプリ本体のアカウント（`<アプリのアカウント ID>`）。CDK が作るのはアプリ本体側の2つで、調査用のクロスアカウントロール（読み取り専用）と、アラームを Webhook へ転送する Lambda。Agent Space の作成・Slack 連携・GitHub 連携・Webhook の発行はコンソールでの手作業になる。

エージェントは秒課金なので、投げるものを絞っている。アラームは `ALARM` に変わったときだけ（復旧では投げない）、AWS Health は実際の障害だけ（予定された変更では投げない）、転送 Lambda 自身の失敗アラームは捨てる。

`agentSpaceArn` がコンテキストに入っているときだけスタックが合成される。コンソール作業が済むまでは `cdk deploy --all` に混ざらない。

```bash
cd infra
AWS_PROFILE=sakekasu-builder npx cdk deploy sakekasu-dev-devops-agent -c env=dev \
  -c agentSpaceArn=arn:aws:aidevops:ap-northeast-1:<運用アカウント ID>:agentspace/xxxxxxxx
```

セットアップ手順、優先度の割り当て、カスタムスキルに入れる運用ナレッジ、費用の詳細は [docs/devops-agent.md](docs/devops-agent.md) にまとめてある。

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
  lambda/        # Lambda 関数（presigned-url, ocr-analyzer, 監視・通知系）
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

## デプロイ（CDK）

**バックエンド（CDK）のデプロイは main へのマージ経由のみ。ローカルからの手動 `cdk deploy` は原則禁止**（Issue #94）。

- main に push（= PR マージ）されると GitHub Actions（`.github/workflows/deploy.yml`）が `cdk deploy --all` を実行する
- PR を開くと `cdk diff` の結果が自動でコメントされる（`.github/workflows/cdk-diff.yml`）
- 認証は OIDC（`sakekasu-github-oidc` スタックの deploy ロール）。リポジトリにアクセスキーは置かない

例外として、以下は今までどおり手動デプロイする:

- `sakekasu-billing-notifier`（管理アカウント宛て。`-c billing=true`）
- `sakekasu-github-oidc`（OIDC 連携自体。Actions に自分のロールを触らせないため。`-c github-oidc=true`）
- ソムリエ Runtime（`agentcore deploy`。CDK 管理外）

### OIDC 連携の初回セットアップ（1回だけ手動）

```bash
cd infra
AWS_PROFILE=sakekasu-builder npx cdk deploy sakekasu-github-oidc -c github-oidc=true
```

これで OIDC プロバイダーと deploy / diff ロールが作られ、以後 Actions が動くようになる。

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
