# お酒の記録アプリ 設計書

最終更新: 2026-11-15
対象: アプリ本体・インフラ・AI エージェントを収めたリポジトリの main ブランチ時点の実装

この文書は、AWS Security Agent のデザインレビューに渡すために、実装済みの構成をセキュリティの観点から書き起こしたものである。
レビューにはこの 1 ファイルだけを渡しても読めるように書いてある。リポジトリの他の文書（README や docs 配下）は参照しなくてよく、必要な事項は本書に要約した。
内容は「何がどこにあり、誰が何にアクセスでき、どこで何を検証しているか」に絞る。
アカウント ID、ユーザープール ID、クライアント ID などの識別子は伏せ、`<...>` で示す。
リソース名とドメインは一般化してある。名前の接頭辞を `app`、ドメインを `example.com` に置き換えており、実物の名前とは異なる。

---

## 1. システム概要

### 1.1 目的

日本酒・ウイスキーなどの「買ったお酒」「飲んだお酒」を記録し、検索・振り返り・AI による補助（ラベル読み取り、テイスティングノート、ソムリエ相談）を行う個人向け Web アプリ。

### 1.2 利用者と規模

| 項目 | 内容 |
| --- | --- |
| 利用者 | 管理者が作成したアカウントのみ（セルフサインアップなし）。実質は本人を含むごく少数 |
| 規模 | 記録は数百〜数千件、OCR は週 50〜60 回程度、リクエストは月に数百〜数千 |
| 環境 | `dev` の 1 環境のみ稼働（名前は `dev` だが実データが入る本番相当） |
| リージョン | ap-northeast-1（東京）。画面配信のスタックのみ us-east-1（CloudFront 用の証明書の都合） |

### 1.3 主な機能

| 区分 | 機能 |
| --- | --- |
| 記録 | 購入記録・飲酒記録の登録・編集・削除、画像添付（1 記録 5 枚まで）、在庫（未開封 / 飲み中 / 飲みきり）の管理 |
| 閲覧 | 一覧・検索・フィルタ（フロントのみで処理）、統計、カレンダー |
| AI | ラベル画像の OCR、テイスティングノートの自動記載、ソムリエ相談チャット（写真添付・Web 検索・会話の記憶つき） |
| 運用 | 監視・アラート通知、DevOps Agent による自動調査、毎日の利用料金通知 |

---

## 2. 全体構成

### 2.1 構成図

同じ内容を AWS アイコンで描いた図を `docs/design-architecture.drawio`（draw.io 形式）に置いた。それを PNG に書き出したものが `docs/design-architecture.png` で、レビューにはこちらを 2 ファイル目として渡す。図を直したら PNG も書き出し直す。図の赤丸 B1〜B9 は 6 章の信頼境界の番号と対応する。

```
                       ┌──────────────────────────────────────────┐
 利用者のブラウザ ────▶ │ CloudFront（app.example.com）            │──OAC──▶ S3（画面の静的ファイル）
  (React SPA)          │  TLS1.2+ / HSTS / CSP / X-Frame-Options   │
                       └──────────────────────────────────────────┘
      │
      │ ① ログイン: 共通ログイン（Cognito マネージドログイン、Authorization code + PKCE、TOTP 必須）
      │             auth.example.com  ※共通基盤のリポジトリが管理
      │
      │ ② GraphQL（Cognito のトークン）
      ▼
 ┌──────────────────────┐      ┌───────────────────────────────┐
 │ AWS AppSync          │─────▶│ DynamoDB                      │
 │ 認可: Cognito User    │ JS   │  dev-app-purchase-records     │
 │ Pool（クライアント限定） │ resolver│  dev-app-drinking-records     │
 └──────────────────────┘      │  （GSI: owner-index）           │
      │ Lambda リゾルバー         └───────────────────────────────┘
      ├──▶ presigned-url Lambda ──▶ S3（dev-app-images。画像の原画とサムネイル）
      ├──▶ ocr-analyzer Lambda ──▶ S3 から画像取得 → Claude API（失敗時 Bedrock）
      └──▶ tasting-note Lambda ──▶ Claude API（失敗時 Bedrock）＋ Tavily 検索 API
      │
      │ ③ 画像の PUT / GET（S3 の Presigned URL。ブラウザから S3 へ直接）
      ▼
     S3（dev-app-images）

      │ ④ ソムリエ相談（Cognito のアクセストークンを Bearer で付与、ストリーミング応答）
      ▼
 ┌──────────────────────────────────┐
 │ Bedrock AgentCore Runtime（PUBLIC）│  JWT Authorizer ＋ アプリ内 JWKS 検証
 │  Strands Agent（Python）           │
 └──────────────────────────────────┘
      ├──▶ DynamoDB（記録の読み取りのみ。owner-index を検証済み sub で引く）
      ├──▶ DynamoDB（dev-app-sommelier-chat-quota。1 日の相談回数）
      ├──▶ AgentCore Memory（会話の続きと好み。actorId = sub、90 日で失効）
      ├──▶ Claude API（失敗時 Bedrock）
      └──▶ Tavily 検索 API（API キーは Secrets Manager）
```

### 2.2 スタック一覧

| スタック | アカウント / リージョン | デプロイ方法 | 中身 |
| --- | --- | --- | --- |
| `app-dev-api` | アプリ / ap-northeast-1 | cdkd（GitHub Actions） | AppSync、DynamoDB 2 本、画像の S3、Lambda 3 本 |
| `app-dev-monitoring` | アプリ / ap-northeast-1 | cdkd（GitHub Actions） | CloudWatch アラーム 22 件、SLO、外形監視 Lambda |
| `app-dev-devops-agent` | アプリ / ap-northeast-1 | cdkd（GitHub Actions） | DevOps Agent が引き受ける読み取りロール |
| `app-dev-site-dns` | アプリ / ap-northeast-1 | cdkd（GitHub Actions） | `app.example.com` のホストゾーン |
| `app-dev-site` | アプリ / us-east-1 | cdkd（GitHub Actions） | 画面の S3、CloudFront、Route 53 レコード |
| `AgentCore-sommelier-dev` | アプリ / ap-northeast-1 | CDK（GitHub Actions） | AgentCore Runtime、Memory、相談回数のテーブル |
| `app-github-oidc` | アプリ / ap-northeast-1 | CloudFormation（手動） | GitHub OIDC プロバイダー、Actions 用ロール、Permissions Boundary |
| `app-billing-notifier` | 管理 / ap-northeast-1 | CloudFormation（手動） | 毎日の利用料金を Slack へ通知 |

### 2.3 同居している他システムとの関係

- 同じ AWS アカウント・リージョンに、別リポジトリで管理する他の 4 システム（3 つのアプリと共通基盤）が同居している。
- 認証基盤（Cognito ユーザープール）と監視の通知先（SNS トピック、Slack 通知、DevOps Agent への転送）は共通基盤が持ち、本アプリは参照するだけ。
- 他アプリとの分離は、命名規約・App タグ・デプロイ用ロールのガードレール（拒否ポリシー）・アプリのロールの Permissions Boundary で行う（8 章）。

### 2.4 技術スタック

| 層 | 採用技術 |
| --- | --- |
| フロントエンド | React 19、TypeScript、Vite 7、Tailwind CSS v4、shadcn/ui、aws-amplify（認証と GraphQL クライアントとして利用） |
| API | AWS AppSync（GraphQL）、AppSync JS リゾルバー、Lambda（Node.js 22、ESM バンドル） |
| データ | DynamoDB（オンデマンド）、S3 |
| AI | Claude API（Claude Haiku 5.5、Workload Identity Federation で API キーなし）、Amazon Bedrock（Claude Haiku 4.5、`jp.` クロスリージョン推論。フォールバック用）、Bedrock AgentCore Runtime / Memory、Strands Agents（Python 3.14） |
| 外部 API | Tavily（Web 検索） |
| IaC / CI | AWS CDK、cdkd（CDK Direct）、GitHub Actions（OIDC） |
| 監視 | CloudWatch（アラーム・Logs・メトリクスフィルター）、Application Signals、X-Ray、AWS DevOps Agent |

---

## 3. データ設計

### 3.1 データストア

| ストア | 名前 | キー | 保護設定 |
| --- | --- | --- | --- |
| DynamoDB | `dev-app-purchase-records` | PK `id`（UUID）、GSI `owner-index`（PK `owner`） | PITR 有効、削除保護、スタック削除時に保持（RETAIN）、AWS 管理キーで暗号化（既定） |
| DynamoDB | `dev-app-drinking-records` | 同上 | 同上 |
| DynamoDB | `dev-app-sommelier-chat-quota` | PK `userKey`（sub の SHA-256）、SK `day` | TTL（`expiresAt`、2 日）。消えても困らないため RemovalPolicy は DESTROY |
| S3 | `dev-app-images` | `{sub}/{purchase|drinking|tmp}/{recordId}/{fileName}` | パブリックアクセス全遮断、SSE-S3、バージョニング、ライフサイクル（下記）、CORS は画面のオリジンと localhost のみ |
| S3 | `dev-app-site-<アカウントID>` | 画面の静的ファイル | パブリックアクセス全遮断、SSE-S3、`enforceSSL`、CloudFront の OAC 経由でのみ読む |
| AgentCore Memory | `preference` | 名前空間 `sommelier/preference/{actorId}`、actorId は sub | イベントは 90 日で失効 |
| Secrets Manager | `dev-app/sommelier/tavily-api-key` | — | 値はリポジトリに置かず手で登録。読めるのは tasting-note Lambda とソムリエ Runtime のロールだけ |

画像バケットのライフサイクル:

| ルール | 対象 | 動作 |
| --- | --- | --- |
| `expire-temporary-uploads` | タグ `lifecycle=temporary`（OCR 用の一時アップロード） | 1 日で現行・旧版とも削除 |
| `expire-noncurrent-versions` | 全オブジェクト | 旧版は 30 日で削除、孤立した削除マーカーも片付ける |

### 3.2 データ分類

| データ | 例 | 分類 | 備考 |
| --- | --- | --- | --- |
| 記録の本文 | 銘柄名、店名、飲んだ場所、価格、評価、感想メモ | 個人データ（行動履歴） | 飲酒の頻度・場所・支出が読み取れる |
| 画像 | ラベル写真、店の棚の写真 | 個人データ | 写り込み（人物・位置情報 EXIF）の可能性がある。EXIF の除去はしていない（9 章） |
| 認証情報 | Cognito の ID / アクセス / リフレッシュトークン | 秘密 | ブラウザに Amplify の既定（localStorage）で保持 |
| ソムリエの会話・好み | 相談内容、抽出された好み | 個人データ | AgentCore Memory に 90 日 |
| ソムリエの画面履歴 | 直近 50 件の会話の写し、セッション ID | 個人データ | ブラウザの localStorage にユーザー単位で保存し、サインアウトで削除 |
| 利用者の識別子 | Cognito の `sub` | 準秘密 | DynamoDB の `owner`、S3 キーの先頭、Memory の actorId に使う。回数テーブルにはハッシュで保存 |
| API キー | Tavily | 秘密 | Secrets Manager |
| 運用の秘密 | Slack Webhook URL | 秘密 | 共通基盤が保持。本アプリは持たない（billing-notifier は管理アカウント側の SSM パラメータ） |

### 3.3 GraphQL スキーマ（要点）

定義の本体はリポジトリの `infra/graphql/schema.graphql`。レビューに要る操作の一覧を下に挙げる。

| 種別 | 操作 | 実装 |
| --- | --- | --- |
| Query | `getPurchaseRecord` / `getDrinkingRecord` | DynamoDB GetItem（JS リゾルバー） |
| Query | `listPurchaseRecords` / `listDrinkingRecords` | DynamoDB Query（`owner-index`、nextToken でページング） |
| Query | `getDownloadUrl` / `getDownloadUrls` | presigned-url Lambda |
| Mutation | `create*` / `update*` / `delete*`（購入・飲酒） | JS リゾルバー。delete は「記録削除 → 画像削除 Lambda」のパイプライン |
| Mutation | `markPurchaseOpened` | 条件付き UpdateItem（未開封のときだけ「飲み中」にする） |
| Mutation | `generateUploadUrl` / `copyImages` | presigned-url Lambda |
| Mutation | `analyzeSakeLabel` | ocr-analyzer Lambda |
| Mutation | `generateTastingNote` | tasting-note Lambda |

`owner`、`id`、`createdAt`、`updatedAt` は入力型に含めず、サーバー側で付ける。

---

## 4. 認証・認可

### 4.1 利用者の認証

| 項目 | 内容 |
| --- | --- |
| IdP | Amazon Cognito ユーザープール（4 アプリ共通。共通基盤が管理） |
| ログイン画面 | Cognito マネージドログイン（`auth.example.com`）へリダイレクト |
| フロー | OAuth 2.0 Authorization code + PKCE。クライアントシークレットなし（パブリッククライアント） |
| MFA | TOTP 必須（パスキーでのログインにも対応） |
| パスワード | 16 文字以上 |
| ユーザー作成 | 管理者のみ（セルフサインアップなし） |
| スコープ | `openid` `email` `profile`。`aws.cognito.signin.user.admin` は付与していない（画面から属性変更・MFA 変更・パスワード変更の API を呼べない） |
| トークン寿命 | アクセス 1 時間、リフレッシュ 30 日 |
| 戻り先 URL | `https://app.example.com/`、`http://localhost:5173/`（完全一致）。ログアウト後は共通の入口 `https://example.com/` |
| サインアウト | Amplify の `signOut`（トークン失効）。ソムリエの画面履歴とセッション ID もあわせて削除 |

### 4.2 API の認可

**AppSync**

- 既定の認可方式は Cognito User Pool のみ（API キー・IAM・OIDC の追加方式なし）。
- 共有プールには他アプリのクライアントもいるため、`appIdClientRegex` で 本アプリのクライアント ID に完全一致するトークンだけを通す。
- 記録単位の認可はリゾルバーで、トークンの `sub`（`ctx.identity.sub`）と記録の `owner` を突き合わせる。

| 操作 | 所有者の確かめ方 |
| --- | --- |
| create | `owner` を `ctx.identity.sub` で上書きして PutItem（入力に `owner` は無い） |
| list | `owner-index` を `ctx.identity.sub` で Query |
| get | 取得後に `result.owner !== ctx.identity.sub` なら `unauthorized` |
| update / delete / markPurchaseOpened | DynamoDB の条件式 `#owner = :expectedOwner`。不一致は Unauthorized |
| 画像キーを含む create / update | キーが `{sub}/` で始まること、一時領域（`{sub}/tmp/...`）でないこと、5 枚以内・空配列でないことをリゾルバーで検証 |
| 画像の URL 発行・複製・削除、OCR | Lambda 内で `identity.sub` を取り、キーの先頭が `{sub}/` であることを検証（`infra/lambda/shared/owner.ts`） |

**ソムリエ（AgentCore Runtime）**

二段で検証する。

1. AgentCore Runtime の JWT Authorizer（`CUSTOM_JWT`）。共通プールの OIDC ディスカバリー URL を使い、`allowedClients` で 本アプリのクライアントに限定する。Runtime に渡すヘッダーは `Authorization` のみ（`requestHeaderAllowlist`）。
2. アプリ内での再検証（`sommelier/app/sommelier/auth.py`）。
   - JWKS で署名を検証（RS256 のみ）。`exp`・`iss`・`sub` を必須にする。
   - `token_use` が `access` なら `client_id`、`id` なら `aud` を許可リストと照合。それ以外の `token_use` は拒否。
   - 未知の `kid` では JWKS を再取得せず拒否（外向きフェッチの増幅を防ぐ）。JWKS は 5 分キャッシュし、取得失敗時は 30 分以内の直近の鍵を使う。
   - 検証に失敗したら `sub` を空にし、モデルを呼ばずに断る（フェイルクローズ）。
   - ローカル開発用のなりすまし（`LOCAL_DEV=1` と `LOCAL_DEV_OWNER_SUB`）は、Cognito の設定と同時に指定できない。

検証済みの `sub` だけが、DynamoDB の owner 絞り込みと Memory の actorId の出どころになる。

### 4.3 機械どうしの認証

| 呼び出し元 → 先 | 方式 |
| --- | --- |
| Lambda / Runtime → Claude API | STS `GetWebIdentityToken` で AWS 署名の JWT（宛先 `https://api.anthropic.com`、寿命 300 秒以内、RS256）を取り、Anthropic 側のフェデレーションルール（発行者・ロール ARN の前方一致 `app-dev-llm-`・宛先）で短命の資格情報と交換。API キーは持たない |
| Lambda / Runtime → Bedrock | 実行ロールの IAM。`bedrock:InvokeModel` を推論プロファイル 1 つとその振り先の foundation-model（ap-northeast-1 / ap-northeast-3）に限定（API スタックの Lambda） |
| Lambda / Runtime → Tavily | Secrets Manager の API キー。読み取り権限はそのシークレットの ARN（`<名前>-*`）だけ |
| GitHub Actions → AWS | GitHub OIDC。ロールごとに `sub`（main ブランチ / pull_request）と `aud` を照合（7 章） |
| DevOps Agent → アカウント | サービスプリンシパル `aidevops.amazonaws.com`。`aws:SourceAccount` と `aws:SourceArn`（Agent Space）で限定し、AWS 管理ポリシー `AIDevOpsAgentAccessPolicy` を付与 |

---

## 5. 主要な処理フローとセキュリティ制御

### 5.1 画像のアップロードと表示

```
ブラウザ ── generateUploadUrl(recordType, recordId, contentType, fileName, fileSize) ──▶ presigned-url Lambda
        ◀── uploadUrl（PUT 用、有効 300 秒）, key = {sub}/{recordType}/{recordId}/{fileName}
ブラウザ ── PUT（画像本体）──▶ S3
ブラウザ ── getDownloadUrls(keys[]) ──▶ presigned-url Lambda ── 各キーの所有者を検証 ──▶ GET 用 URL（有効 3600 秒）
```

| 制御 | 内容 |
| --- | --- |
| 置き場所の固定 | キーはサーバーが組み立てる。先頭は必ずトークンの `sub` |
| 入力検証 | `contentType` は `image/jpeg` / `image/png` のみ。`recordType` は `purchase` / `drinking` のみ。`recordId` は UUID 形式。`fileName` は `/`・`.`・`..` を拒否し、`thumb_` で始まる名前は原画として受け付けない |
| サイズ上限 | `fileSize`（1 バイト〜5MB）を必須にし、`ContentLength` として署名に含める。署名した大きさ以外では PUT できない |
| 一時アップロード | OCR 用は `{sub}/tmp/...` にタグ付きで置き、1 日で自動削除。記録には一時キーを保存させない |
| ダウンロード | 1 回 100 キーまで。全キーの先頭が `{sub}/` であることを確認してから署名 |
| 複製（在庫から飲む） | `copyImages` は複製元・複製先とも呼び出し者のキーに限る。S3 内でコピーし、バイト列は Lambda を通さない |
| 削除 | 記録削除のパイプラインで画像削除 Lambda を呼ぶ。画像削除の失敗はメトリクス化してアラーム |

### 5.2 ラベル画像の OCR

```
ブラウザ ── analyzeSakeLabel(imageKey, additionalImageKeys) ──▶ ocr-analyzer Lambda
  → キーの所有者を検証 → S3 から取得 → マジックバイトで画像形式を確認 → サイズ上限を確認
  → Claude API（tool use で構造化出力）／失敗時 Bedrock → 結果を整形して返す
```

| 制御 | 内容 |
| --- | --- |
| 対象画像 | 最大 3 枚。すべて呼び出し者のキーであること |
| 形式の確認 | Content-Type ではなく先頭バイト（JPEG / PNG / GIF / WebP のシグネチャ）で判定 |
| サイズ | base64 で 5MB（Bedrock の上限）に収まること |
| 出力 | 決まった tool のスキーマで受け取り、項目ごとに型と範囲を検査してから返す |
| ログ | 抽出結果の本文は残さず、検出したかどうかと確信度だけを残す |
| 費用・暴走対策 | 予約同時実行 20、タイムアウト 30 秒 |
| テレメトリ | Application Signals で計装。ただしモデルへのリクエスト本文（base64 画像）をスパンに載せない設定を明示 |

### 5.3 テイスティングノート

- 入力は銘柄名（200 文字まで）とカテゴリ（`WHISKY` / `NIHONSHU` のみ、他はエラー）。
- モデルが銘柄を知らないと答えた場合のみ Tavily で検索し、検索結果を添えてもう一度生成する。知らなければ null を返し、作り話をさせない。
- 予約同時実行 5、タイムアウト 25 秒。失敗しても記録の保存は止めない。

### 5.4 ソムリエ相談

```
ブラウザ ── POST /invocations（Bearer トークン、prompt、sessionId、images[]）──▶ AgentCore Runtime
  → JWT 検証（二段）→ 入力の検証と無害化 → 1 日の回数を消費
  → Memory から会話の続き（直近 10 件）と好み（上位 5 件）を取得
  → Strands Agent（ツール: list_my_purchase_records / list_my_drinking_records / search_web）
  → ストリーミングで返答 → 会話を Memory に書き込む
```

| 制御 | 内容 |
| --- | --- |
| 入力長 | プロンプト 4,000 文字。正規化で文字数が増えるため、正規化後にも判定 |
| 画像 | 最大 3 枚、1 枚 5MB、合計 10MB。base64 の長さをデコード前に判定し、`validate=True` で厳密にデコード |
| 回数上限 | ユーザーごとに 1 日 50 回（日本時間の 0 時で区切り）。DynamoDB の条件付き UpdateItem で同時実行でも超えない。数えられないときはモデルを呼ばない（フェイルクローズ） |
| データアクセス | ツールは検証済み `sub` で `owner-index` を Query するだけ。Runtime のロールが持つ権限は 2 テーブルの `Query` / `GetItem`（テーブルと `owner-index`）のみで、書き込みは無い |
| ツールの返却値 | メモは 200 文字、その他の文字列は 120 文字に切り詰め、取得は 10 ページまで |
| プロンプトインジェクション対策 | 記録・プロンプト・好み・会話履歴・検索結果は、HTML エンティティ展開と NFKC 正規化を収束するまで繰り返してから山括弧を潰し、`<user_data>` / `<web_data>` の境界タグを偽造できなくしてから渡す。収束しない入力は破棄。システムプロンプトに入れる値は改行を畳み、見出しの差し込みを防ぐ。写真内の文字も指示ではなくデータとして扱うようシステムプロンプトで指示 |
| Web 検索の出典 | URL の形式を検査し、通らない結果は捨てる。件数は既定 3・最大 5、`search_depth=basic`、本文の全文取得はしない |
| 記憶 | actorId は `sub`。会話は 90 日で失効。記憶の取得に失敗しても相談は続ける（フェイルオープン。記憶なしで答えるだけで、他人のデータは出ない） |
| セッション | セッション ID はクライアントが作り localStorage に保存。「新しい相談」とサインアウトで破棄 |

### 5.5 画面の配信

| 制御 | 内容 |
| --- | --- |
| TLS | ACM 証明書、最低 TLS 1.2（`TLSv1.2_2021`）、HTTP は HTTPS へリダイレクト、HTTP/2・HTTP/3 |
| オリジン | S3 は非公開。CloudFront の OAC でのみ読む |
| メソッド | GET / HEAD のみ |
| ヘッダー | HSTS（365 日、サブドメイン含む）、`X-Content-Type-Options`、`X-Frame-Options: DENY`、`Referrer-Policy: strict-origin-when-cross-origin`、`X-XSS-Protection`、`Permissions-Policy: camera=(), microphone=(), geolocation=()` |
| CSP | 下記 |
| SPA のルーティング | 403 / 404 を `/index.html`（200）に置き換える |

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: blob: https://<画像バケットのドメイン>;
connect-src 'self' https://<AppSync のオリジン> https://cognito-idp.ap-northeast-1.amazonaws.com
            https://<マネージドログインのドメイン> https://bedrock-agentcore.ap-northeast-1.amazonaws.com
            https://<画像バケットのドメイン>;
frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
```

`style-src` の `'unsafe-inline'` は React が style 属性を直接付ける箇所があるため残している。

---

## 6. 信頼境界と外部依存

| 境界 | 内側 | 外側 | 境界での制御 |
| --- | --- | --- | --- |
| B1 | CloudFront | インターネット | TLS、セキュリティヘッダー、CSP |
| B2 | AppSync | ブラウザ | Cognito トークン（クライアント限定）、リゾルバーでの所有者確認 |
| B3 | S3（画像） | ブラウザ | 短命の Presigned URL、キーの所有者確認、サイズとコンテンツタイプを署名に含める |
| B4 | AgentCore Runtime | ブラウザ | JWT Authorizer ＋ アプリ内検証、入力上限、回数上限 |
| B5 | LLM のコンテキスト | 利用者の入力・記録・画像・検索結果 | 無害化と境界タグ、ツールは自分の記録の読み取りのみ |
| B6 | アプリのアカウント | Anthropic（Claude API） | 短命 JWT のフェデレーション、宛先固定 |
| B7 | アプリのアカウント | Tavily | Secrets Manager の API キー、国指定・件数制限 |
| B8 | アプリのアカウント | 同居する他アプリ | ガードレール（拒否ポリシー）、Permissions Boundary、命名とタグ |
| B9 | AWS アカウント | GitHub Actions | OIDC の `sub` 照合、役割ごとのロール分割 |

外部へ送るデータ:

| 送り先 | 送るもの |
| --- | --- |
| Anthropic（Claude API） | ラベル画像、銘柄名、ソムリエの相談内容・添付写真・記録の抜粋・記憶 |
| Amazon Bedrock | 同上（Claude API が失敗したときのみ） |
| Tavily | 検索クエリ（銘柄名や相談から作った文字列） |
| Slack（共通基盤経由） | アラームの内容、利用料金 |

---

## 7. CI/CD とデプロイ

### 7.1 ワークフロー

| ワークフロー | きっかけ | 使うロール | 内容 |
| --- | --- | --- | --- |
| `test.yml` | PR | なし | フロント・infra・ソムリエのテスト、lint、型検査 |
| `cdk-diff.yml` | PR | `app-github-actions-diff`（読み取りのみ、`sub` = `pull_request`） | cdkd diff を PR にコメント |
| `deploy.yml` | main へのマージ | `app-github-actions-deploy` → `app-cdkd-deploy` | infra を cdkd でデプロイ |
| `deploy-sommelier.yml` | main へのマージ（`sommelier/` の変更） | `app-github-actions-deploy` | pytest と synth テストの後に CDK でデプロイ |
| `deploy-site.yml` | main へのマージ | `app-github-actions-site` | フロントをビルドしてから認証情報を取り、配信バケットへ同期 |
| `claude-review.yml` | PR | なし（Claude Code の OAuth トークン） | AI によるコードレビュー |
| `claude-hooks.yml` | PR | なし | Claude Code のフックのテスト |

`pull_request_target` は使っていない。AWS のアカウント ID はリポジトリに書かず、GitHub の Secrets から渡す。

### 7.2 デプロイ用ロールの設計

| ロール | 信頼 | 権限 |
| --- | --- | --- |
| `app-github-actions-deploy` | GitHub OIDC、main ブランチのみ | cdkd ロールと CDK bootstrap ロールへの AssumeRole だけ |
| `app-cdkd-deploy` | 上の deploy ロールのみ（GitHub から直接は引き受けられない）。セッション 1 時間 | 本アプリのリソースを作り替える権限 ＋ 拒否だけのガードレール（下記） |
| `app-github-actions-diff` | GitHub OIDC、pull_request のみ | 読み取りのみ |
| `app-github-actions-site` | GitHub OIDC、main ブランチのみ。セッション 1 時間 | 配信バケットの List / Put / Delete のみ。CloudFront・IAM には触れない |

ガードレール（`app-cdkd-deploy-guardrail`、拒否のみ）の主な文:

- 他アプリのリソース・他アプリの App タグが付いたリソースへの操作を拒否
- 本アプリの接頭辞の外にあるロールの作成・変更を拒否、GitHub Actions 用ロールの改ざんを拒否
- Permissions Boundary を付けないロールの作成、境界の取り外し・書き換えを拒否
- cdkd の状態バケットの設定変更、他アプリの状態ファイルの書き込み、共用資産の破壊を拒否
- 他アプリの AgentCore Runtime への操作を拒否

### 7.3 アプリのロールの Permissions Boundary

cdkd が作るアプリのロール（Lambda など）には `app-role-boundary` を必ず付ける。

- `iam:*`、`organizations:*`、`account:*` を拒否
- `sts:*` を拒否。例外は宛先を指定した `sts:GetWebIdentityToken` だけで、宛先が `https://api.anthropic.com` 以外なら拒否

アプリのロールが乗っ取られても、権限昇格・他アカウントへの横移動・任意の宛先への ID トークン発行はできない。

### 7.4 手元からの操作

- 手元からの `cdkd deploy` / `cdk deploy` は禁止（例外は GitHub Actions のロールのスタックと管理アカウントの billing-notifier）。
- AI エージェント（Claude Code）が AWS を確認するときは、読み取り専用の Permission Set（`AgentVerifyAccess`）を SSO で使う。S3 オブジェクト本文・DynamoDB のレコード・Cognito ユーザー・SSM パラメータは IAM 側で拒否している。

---

## 8. 最小権限の一覧（アプリのロール）

| ロール | 主な権限 |
| --- | --- |
| presigned-url Lambda | 画像バケットの読み書き（`grantReadWrite`）、ログ、X-Ray、Application Signals |
| ocr-analyzer Lambda（`app-dev-llm-ocr-analyzer`） | 画像バケットの読み取り、`bedrock:InvokeModel`（1 モデルのみ）、`sts:GetWebIdentityToken`（条件付き）、ログ、X-Ray、Application Signals |
| tasting-note Lambda（`app-dev-llm-tasting-note`） | `bedrock:InvokeModel`（1 モデルのみ）、`sts:GetWebIdentityToken`（条件付き）、Tavily キーの `GetSecretValue`、ログ、X-Ray |
| ソムリエ Runtime（`app-dev-llm-sommelier`） | 記録 2 テーブルの `Query` / `GetItem`、回数テーブルの `UpdateItem`、`sts:GetWebIdentityToken`（条件付き）、Tavily キーの `GetSecretValue`、AgentCore Memory と Bedrock の呼び出し（AgentCore の CDK コンストラクトが付与） |
| AppSync のデータソース | 各テーブルへの読み書き（CDK の `addDynamoDbDataSource` の既定）、各 Lambda の Invoke |
| DevOps Agent 用 | `AIDevOpsAgentAccessPolicy`（読み取り）、Resource Explorer のサービスリンクロール作成のみ |

---

## 9. ログ・監視・可用性

### 9.1 ログ

- Lambda は CloudWatch Logs（ロググループと保持期間をスタックで管理）。AgentCore Runtime のログも CloudWatch Logs。
- AppSync のフィールドログ（`logConfig`）は設定していない（10 章）。
- OCR のログには抽出した本文を残さず、検出の有無・確信度・呼び先だけを残す。
- Application Signals のスパンにモデルへのリクエスト本文を載せない（`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false`）。

### 9.2 監視（22 アラーム）

| 分類 | 監視対象 |
| --- | --- |
| 認証 | ソムリエ Runtime の認証拒否（`InboundAuthorizationFailure`、例外の種類ごと） |
| AI | Runtime のシステムエラー・スロットル、OCR のエラー・スロットル・SLO、Claude API から Bedrock へのフォールバック回数 |
| サービス | AppSync 5XX、各 Lambda のエラー、DynamoDB スロットル、画像削除の失敗 |
| 外形監視 | ソムリエ Runtime と AppSync を認証なしで叩き、401 / 403 が返ることを正常とみなす（鍵を持たずに「生きている」「認証が効いている」を確かめる） |
| 監視自体 | 外形監視の失敗・未実行 |

通知は共通基盤の SNS トピックから Slack と DevOps Agent（自動調査）へ流れる。

### 9.3 可用性とバックアップ

| 対象 | 方式 |
| --- | --- |
| 記録 | DynamoDB の PITR（35 日）、削除保護、スタック削除時も保持 |
| 画像 | S3 バージョニング（旧版は 30 日保持） |
| AI | Claude API が失敗したら Bedrock でやり直す。AI が失敗しても記録の保存は止めない |
| 費用の天井 | OCR とテイスティングノートの予約同時実行、ソムリエの 1 日 50 回、毎日の利用料金通知 |

---

## 10. 前提・既知の制約・レビューで見てほしい点

設計時点で把握している、対策していない・判断を保留している事項。レビューでの評価と優先度づけを期待している。

| # | 事項 | 現状 |
| --- | --- | --- |
| 1 | AWS WAF | CloudFront、AppSync、AgentCore Runtime のいずれにも付けていない。利用者が少数で、認証必須・回数上限・予約同時実行で費用の上限を置くことで代えている |
| 2 | アクセスログ | CloudFront・S3 のアクセスログ、AppSync のフィールドログはいずれも有効にしていない。CloudTrail は組織側の設定に依存 |
| 3 | トークンの保管場所 | Amplify の既定（localStorage）。XSS が起きた場合にトークンが読まれる。CSP の `script-src 'self'` で緩和している |
| 4 | 画像の EXIF | アップロード時に位置情報などのメタデータを除去していない。画像は本人しか見られない前提 |
| 5 | アップロードした画像の中身の検証 | Presigned URL の PUT 時点ではサイズとコンテンツタイプのみ。マジックバイトの確認は OCR 時だけで、マルウェアスキャンは無い |
| 6 | `list*` の `limit` | クライアントが指定した値に上限を設けていない（既定 100）。自分の記録しか返らないため影響は自分の範囲に留まる |
| 7 | 飲酒記録の `purchaseRecordId` | 紐づけ先の購入記録が呼び出し者のものかはリゾルバーで確かめていない（値を保存するだけで、他人の記録の読み書きには使われない） |
| 8 | GraphQL のイントロスペクションとクエリの深さ・複雑さの制限 | AppSync の既定のまま |
| 9 | 共通ユーザープール | 4 アプリで共有。プールの設定（MFA・パスワードポリシー・アカウント作成）は別リポジトリの管理で、本アプリからは変えられない |
| 10 | 環境が 1 つ | `dev` が本番相当で、検証用の環境が無い。変更は PR のテスト・synth テスト・cdkd diff で確かめてからマージする |
| 11 | 外部 LLM へのデータ送信 | 画像や相談内容を Anthropic へ送る。主経路は Claude API で、Bedrock はフォールバック |
| 12 | DynamoDB・S3 の暗号化キー | AWS 管理キー（SSE-S3 / DynamoDB の既定）。カスタマー管理キーは使っていない |

---

## 11. 本書に含めていない資料

次の文書はリポジトリにあるが、レビューには渡していない。設計の判断に要る事項は本書の各章に要約してある。

| リポジトリ内のパス | 内容 | 本書での要約先 |
| --- | --- | --- |
| `README.md` | 機能、設計判断の経緯、監視、デプロイ、テスト | 1・2・9 章 |
| `docs/shared-login.md` | 共通ログインへの切り替え | 4.1 |
| `docs/claude-api.md` | Claude API の ID 連携と Bedrock へのフォールバック | 4.3 |
| `docs/aws-infra-rules.md` | 同居アプリとの分離、ガードレール、Permissions Boundary | 2.3・7 章 |
| `docs/sake-subdomain.md` | S3 + CloudFront での配信 | 5.5 |
| `docs/agent-verify-permission-set.md` | AI エージェント用の読み取り専用 Permission Set | 7.4 |
| `docs/application-signals.md` | APM の計装と SLO | 9 章 |
| `docs/devops-agent.md` | DevOps Agent の設定 | 4.3・9 章 |
| `docs/operations.md` | 手作業の運用手順 | 7.4 |
