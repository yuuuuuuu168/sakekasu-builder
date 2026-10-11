# Claude API への切り替え

OCR・テイスティングノート・ソムリエが呼ぶ Claude を、Amazon Bedrock から Anthropic の Claude API（`api.anthropic.com`）に切り替えた。Max プランに付く月々の API クレジット（Claude Console の personal Organization）で払うため。

Bedrock の実装は消していない。Claude API がクレジット切れ・認証・障害で失敗したら、同じ頼みを Bedrock の旧モデル（Claude Haiku 4.5）でやり直す。

## 構成

| 機能 | 実行環境 | 呼び出し口 | Claude API のモデル | 控え（Bedrock） |
| --- | --- | --- | --- | --- |
| OCR（ラベル読み取り） | Lambda `{env}-sakekasu-ocr-analyzer` | [infra/lambda/shared/llm.ts](../infra/lambda/shared/llm.ts) | `claude-haiku-5-5` | `jp.anthropic.claude-haiku-4-5-20251001-v1:0` |
| テイスティングノート | Lambda `{env}-sakekasu-tasting-note` | 同上 | `claude-haiku-5-5` | 同上 |
| ソムリエ（チャット） | AgentCore Runtime | [sommelier/app/sommelier/model/load.py](../sommelier/app/sommelier/model/load.py) | `claude-haiku-5-5` | 同上 |

モデルは 3 つとも Haiku 5.5 から始める。精度が足りなければ環境変数（下の表）で上げる。

Claude API には **API キーを持たずに入る**（[Workload Identity Federation](https://platform.claude.com/docs/en/manage-claude/wif-providers/aws)）。実行ロールで STS の `GetWebIdentityToken` を呼んで AWS が署名した JWT をもらい、SDK が Anthropic の短命のトークンと交換する。秘密の値はどこにも置かない。sakekasu-kakeibo と同じ仕組みで、AWS アカウントの Outbound web identity federation と Claude Console の発行者は kakeibo と共有している。

```
Lambda / Runtime の実行ロール
   │ sts:GetWebIdentityToken（宛先 https://api.anthropic.com）
   ▼
AWS が署名した JWT ──→ Anthropic のトークン交換（ルール sakekasu-builder-workload）
                          │ 件名プレフィックス arn:aws:iam::<アカウントID>:role/sakekasu-dev-llm-
                          ▼
                     短命のトークン（10 分）──→ api.anthropic.com/v1/messages
```

### アプリごとに分けるもの・共有するもの

| | 共有 | builder 専用 |
| --- | --- | --- |
| 組織・クレジット | ✓ | |
| AWS の Outbound web identity federation（アカウント設定） | ✓（kakeibo で有効化済み） | |
| Claude Console の発行者（Issuer） | ✓ | |
| ワークスペース | | `sakekasu-builder` |
| サービスアカウント | | `sakekasu-builder` |
| フェデレーションルール | | `sakekasu-builder-workload` |

ワークスペースを分けると、使用量とコストをアプリ別に見られ、利用上限（spend limit）もアプリ別にかけられる。課金とクレジットは組織に 1 つで、分けても変わらない。

## Bedrock に戻す条件

Claude API が次の理由で失敗したら Bedrock でやり直す。それ以外の 4xx はこちらの頼み方の誤りなので、やり直さずに失敗にする。

| `errorType` | 何が起きたか | 疑うところ |
| --- | --- | --- |
| `credit_balance` / `billing` | 残高不足（400 の `credit balance is too low`）・支払いの問題（402） | Claude Console のクレジット。月が替われば戻る |
| `authentication` / `permission` | 401 / 403 | Claude Console のルール（件名プレフィックス・audience・ワークスペース）。[認証履歴](https://platform.claude.com/settings/workload-identity-federation?tab=history)に拒否の理由が出る |
| `credentials` | STS で JWT を取れない、トークンの交換に失敗 | Permissions Boundary の反映漏れ、アカウントの Outbound web identity federation、実行ロールの権限の条件 |
| `rate_limit` / `overloaded` / `server_error` / `timeout` / `connection` | 429 / 529 / 5xx / 通信 | Claude API 側の混雑や障害。続かなければ放っておいてよい |
| `refusal` | モデルが断った（OCR とノートのみ） | 画像や銘柄名の中身 |

SDK の再試行はしない（`maxRetries: 0`、ソムリエは Strands の `retry_strategy=None`）。待つより Bedrock でやり直したほうが早く答えられ、AppSync の 30 秒の枠にも収まる。

ソムリエは**応答を 1 文字も返していないとき**だけやり直す。途中まで返した後にやり直すと、利用者に同じ答えが二重に届くため。

フォールバックしたら 1 行の JSON をログに出す。CloudWatch Logs で `[llm] fallback` を探す。

```
[llm] fallback {"fallback":true,"feature":"ocr","from":"anthropic","to":"bedrock","errorType":"credit_balance","status":400,"message":"..."}
```

OCR とテイスティングノートはメトリクスフィルタ（`{env}-sakekasu` / `LlmFallbackCount`）で数え、1 時間に 3 回以上でアラーム `{env}-sakekasu-llm-fallback` が Slack に鳴る。ソムリエのログは Runtime のロググループ（`/aws/bedrock-agentcore/runtimes/...-DEFAULT`）に同じ形で出るが、フィルタはまだ作っていない。

### 消費の記録

呼び出しのたびに使ったトークン数を 1 行の JSON で出す。キャッシュの効き（`cacheRead`）もここで見る。

```
[llm] usage {"feature":"ocr","provider":"anthropic","model":"claude-haiku-5-5","ms":2140,"stopReason":"tool_use","usage":{"input":1830,"output":420,"cacheRead":1500,"cacheWrite":0}}
```

CloudWatch Logs Insights で 1 リクエストあたりの消費を集計できる。

```
fields @timestamp, @message
| filter @message like /\[llm\] usage/
| parse @message '"provider":"*"' as provider
| parse @message '"input":*,' as input
| parse @message '"output":*,' as output
| parse @message '"cacheRead":*,' as cacheRead
| stats count() as calls, avg(input) as avgInput, avg(output) as avgOutput, avg(cacheRead) as avgCacheRead by provider
```

## Bedrock 向けとの違い

| 項目 | Claude API | Bedrock（控え） |
| --- | --- | --- |
| `temperature` | 渡さない（今の世代は既定値以外を 400 で弾く） | `0`（切り替え前と同じ） |
| tool の強制（`tool_choice: tool`） | Haiku だけ強制する。Sonnet 5.5 / Opus 5.5 は 400 になるので `auto` にして、tool の説明文で呼ばせる | 強制する |
| `effort` | OCR・ノートは `low`、ソムリエは `medium` | 渡さない |
| プロンプトキャッシュ | tool の定義と、ソムリエのシステムプロンプトのうち毎回同じ前半 | 付けない（旧モデルは最小長に届かない） |

ソムリエのシステムプロンプトは、指示・今日の日付・検索の節（日付が変わるまで同じ）の後ろに `cachePoint` を置き、相談ごとに変わる「覚えている好み」をその後ろに回している。記録を引く tool を挟んでモデルを呼び直すたびに、前半はキャッシュから読まれる。

OCR 用の画像は、フロントで長辺 1568px に縮小済み（[imageCompressor.ts](../src/features/image/utils/imageCompressor.ts)）。ソムリエのチャットに添付する写真も同じ関数を通る。サーバー側で縮め直してはいない。

即時性の要らない OCR を Message Batches API に回せるよう、頼み方の組み立て（`buildLabelRequest`）と送信を分けてある。バッチ処理そのものは作っていない。

### AgentCore Memory

変えていない。Memory リソース、ストラテジー、`create_event` / `list_events` / `retrieve_memory_records` の呼び出しはそのまま。

読み戻した履歴は、もともと Strands の内部形式（`{"role": ..., "content": [{"text": ...}]}`）で Agent に渡していた。Converse API の形ではなく、Strands がモデルごとに変換するので、Claude API に切り替えても形を直す処理は要らなかった。好みはシステムプロンプトに文字列で入れているので、呼び先に左右されない。

## 環境変数

| 環境変数 | 渡す先 | 値 | 意味 |
| --- | --- | --- | --- |
| `LLM_PROVIDER` | 3 つとも | `anthropic` / `bedrock` | 既定の呼び先。ID 連携の値が無ければ `anthropic` でも Bedrock だけで動く |
| `ANTHROPIC_MODEL_OCR` | OCR | `claude-haiku-5-5` | 精度が足りなければ `claude-sonnet-5-5` などに上げる |
| `ANTHROPIC_MODEL_NOTE` | テイスティングノート | `claude-haiku-5-5` | |
| `ANTHROPIC_MODEL_CHAT` | ソムリエ | `claude-haiku-5-5` | 品質を見て `claude-sonnet-5-5` に上げる |
| `BEDROCK_MODEL_ID` | 3 つとも | `jp.anthropic.claude-haiku-4-5-20251001-v1:0` | 控えのモデル（切り替え前と同じ） |
| `ANTHROPIC_FEDERATION_RULE_ID` ほか 3 つ | 3 つとも | Claude Console の ID | ID 連携で交換するルール・組織・サービスアカウント・ワークスペース |

Lambda の値は [infra/lib/api-stack.ts](../infra/lib/api-stack.ts) が、ソムリエの値は [sommelier/agentcore/agentcore.json](../sommelier/agentcore/agentcore.json) の `envVars` が持つ。ID 連携の値は、Lambda は `infra/cdk.json` の context `anthropicFederation`、ソムリエは `agentcore.json` の `envVars` に書く。どれも秘密ではない（鍵ではなく、どのルールで交換するかの指定）。

## IAM の差分

| ロール | 変更 |
| --- | --- |
| OCR の実行ロール | 名前を `sakekasu-{env}-llm-ocr-analyzer` に固定。`sts:GetWebIdentityToken` を追加（ID 連携の値があるときだけ） |
| テイスティングノートの実行ロール | 名前を `sakekasu-{env}-llm-tasting-note` に固定。同上 |
| ソムリエの実行ロール | 名前を `sakekasu-dev-llm-sommelier` に固定。同上 |
| Permissions Boundary `sakekasu-role-boundary` | `sts:*` の一律拒否を、「宛先が Anthropic の `GetWebIdentityToken` だけ通す」形に変更 |

`sts:GetWebIdentityToken` は条件で絞っている。宛先は `https://api.anthropic.com` だけ、寿命は 300 秒まで、署名は RS256。

Bedrock の `InvokeModel` 権限はフォールバック用に残している。AgentCore Memory の権限は変えていない。Secrets Manager の権限は足していない（API キーを持たないため）。

**ロール名を固定した理由。** Claude Console のルールは、JWT の件名（ロールの ARN）の前方一致で照合する。自動の名前では末尾が乱数になり、作り直すたびに変わる。名前を `sakekasu-{env}-` で始めているのは、cdkd のデプロイロールのガードレール（[deploy-guardrail.ts](../infra/lib/deploy-guardrail.ts) の `DenyRolesOutsideApp`）がその頭のロールしか作らせないため。続けて `llm-` を挟み、ルールの前方一致を Claude を呼ぶロールだけに絞っている。

**境界を開けた範囲。** アプリのロールの境界は、権限昇格の連鎖を切るために `sts:*` を拒否していた（Issue #150）。これを次の 2 文に分けた。

1. 宛先の条件キー（`sts:IdentityTokenAudience`）を持たない STS の操作をすべて拒否する。この条件キーを持つのは `GetWebIdentityToken` だけなので、`AssumeRole` などはこれまでどおり拒否のまま。AWS が STS に新しい操作を足しても、条件キーを持たなければここで止まる
2. 宛先に Anthropic 以外が 1 つでも混ざった `GetWebIdentityToken` を拒否する

このロールを乗っ取っても、作れる JWT で入れるのは Claude Console のルールが認めたワークスペースの推論だけで、AWS や他のサービスには入れない。

### ネットワーク

Lambda は VPC の外、AgentCore Runtime は `networkMode: PUBLIC` なので、`api.anthropic.com` への HTTPS はそのまま届く。NAT は要らない。

## 有効にする手順

コードは、ID 連携の値が無ければ Bedrock だけで動く。マージしてデプロイしただけでは挙動は変わらない。次の順で有効にする。

### 1. Permissions Boundary を反映する（人間様、AWS）

境界は `sakekasu-github-oidc` スタックにあり、Actions からはデプロイしない（自分を締め出す事故を避けるため。[cdkd-migration.md](cdkd-migration.md)）。管理者のプロファイルで反映する。

```sh
cd infra
AWS_PROFILE=sakekasu-builder npx cdk diff sakekasu-github-oidc -c github-oidc=true
AWS_PROFILE=sakekasu-builder npx cdk deploy sakekasu-github-oidc -c github-oidc=true
```

diff に出るのは境界ポリシー（`sakekasu-role-boundary`）の Deny 文の変更だけのはず。これを飛ばして 3 に進むと、STS が境界で拒否され、毎回 `errorType: credentials` で Bedrock へ回る。

### 2. この PR をマージしてデプロイする

Actions がデプロイする。実行ロールが固定の名前で作り直される。この時点では ID 連携の値が無いので、3 つとも Bedrock で動く（切り替え前と同じ）。

### 3. Claude Console で builder 用の設定を作る（人間様）

Settings で次を作る。

1. **ワークスペース** `sakekasu-builder`（任意で利用上限を設定）
2. **サービスアカウント** `sakekasu-builder`
3. Settings → Workload identity で、発行者は kakeibo と同じもの（`aws-...`）を選び、**ルール** `sakekasu-builder-workload` を作る

| 項目 | 値 |
| --- | --- |
| 件名プレフィックス | `arn:aws:iam::<アカウントID>:role/sakekasu-dev-llm-` |
| audience | `https://api.anthropic.com` |
| 対象 | サービスアカウント `sakekasu-builder` |
| ワークスペース | `sakekasu-builder` |
| OAuth スコープ | `workspace:developer` |
| トークンの有効期間 | 600 秒 |

作ったら、ルール（`fdrl_...`）・組織（UUID）・サービスアカウント（`svac_...`）・ワークスペース（`wrkspc_...`）の ID を控える。

### 4. ID を設定ファイルに入れる（エージェントでも可）

`infra/cdk.json` の context に足す。

```json
"anthropicFederation": {
  "ruleId": "fdrl_...",
  "organizationId": "...",
  "serviceAccountId": "svac_...",
  "workspaceId": "wrkspc_..."
}
```

`sommelier/agentcore/agentcore.json` の `envVars` に足す。

```json
{ "name": "ANTHROPIC_FEDERATION_RULE_ID", "value": "fdrl_..." },
{ "name": "ANTHROPIC_ORGANIZATION_ID", "value": "..." },
{ "name": "ANTHROPIC_SERVICE_ACCOUNT_ID", "value": "svac_..." },
{ "name": "ANTHROPIC_WORKSPACE_ID", "value": "wrkspc_..." }
```

PR にしてマージすると、ロールに `sts:GetWebIdentityToken` が付き、3 つとも Claude API を先に呼ぶようになる。

### 5. 確かめる

| 確認 | 誰が | 方法 |
| --- | --- | --- |
| Claude API で答えている | エージェント（読み取り専用のプロファイル） | 各ロググループで `[llm] usage` の `provider` が `anthropic` |
| フォールバックが起きていない | 同上 | `[llm] fallback` が出ていない。アラーム `{env}-sakekasu-llm-fallback` が鳴っていない |
| キャッシュが効いている | 同上 | ソムリエ・ノートの `[llm] usage` で `cacheRead` が 0 でない |
| OCR・ノートが動く | 人間様 | 画面でラベルを読ませる。ウイスキーか日本酒を登録してノートが入る |
| 短期記憶が効いている | 人間様 | 同じ会話で 3 ターン相談し、前の発言を踏まえた応答になる |
| 長期記憶が効いている | 人間様 | 切り替え前に話した好みが、切り替え後の提案の理由に出てくる |
| 使用量がワークスペースに付く | 人間様（Console） | Usage で `sakekasu-builder` に計上されている |

フォールバックそのものを確かめたいときは、一時的にルールを無効にする（または Console で別のワークスペースだけを認可する）と、`errorType: authentication` で Bedrock に回り、`[llm] fallback` が出る。確かめたら戻す。

## 戻し方

- **1 つの機能だけ Bedrock に戻す**: その関数の `LLM_PROVIDER` を `bedrock` にする（Lambda は [api-stack.ts](../infra/lib/api-stack.ts) の `llmEnvironment`、ソムリエは `agentcore.json`）
- **全部 Bedrock に戻す**: `infra/cdk.json` の `anthropicFederation` と、`agentcore.json` の `ANTHROPIC_FEDERATION_*` を消す。ロールの STS の権限も一緒に外れる
- **境界まで元に戻す**: [role-boundary.ts](../infra/lib/role-boundary.ts) の 2 文を `sts:*` の一律拒否に戻し、手順 1 と同じく手動でデプロイする

ロール名の固定は戻さなくてよい（名前が決まっているだけで、権限は変わらない）。

## テスト

| 対象 | どこで | 内容 |
| --- | --- | --- |
| Lambda の呼び出し口 | [infra/lambda/shared/__tests__/llm.test.ts](../infra/lambda/shared/__tests__/llm.test.ts) | 呼び先の決め方、フォールバックする失敗としない失敗、`fallback=true` のログ、usage のログ、Claude API と Bedrock の頼み方の違い |
| CDK（infra） | [infra/__tests__/claude-api.test.ts](../infra/__tests__/claude-api.test.ts) | ロール名、環境変数、STS の権限と条件、境界の 2 文、メトリクスフィルタとアラーム |
| ソムリエ | [sommelier/app/sommelier/tests/test_llm_fallback.py](../sommelier/app/sommelier/tests/test_llm_fallback.py) | 呼び先の決め方、応答前だけのフォールバック、履歴の写し、キャッシュの区切り、usage のログ |
| CDK（ソムリエ） | [sommelier/agentcore/cdk/test/cdk.test.ts](../sommelier/agentcore/cdk/test/cdk.test.ts) | ロール名、環境変数、STS の権限と条件 |

実際に Claude API を呼ぶ確認（3 ターンの会話、長期記憶、実画像の OCR）は、ID 連携を有効にした後に手順 5 で行う。

## やっていないこと

- Bedrock 関連コードの削除
- AgentCore Memory のリソース・ストラテジー・保存と取得の処理の変更
- Claude Console 側の設定（手順 3。利用上限も手動）
- ソムリエのフォールバックのメトリクスフィルタとアラーム（ログは出している）
- ソムリエでモデルが断った（`stop_reason: refusal`）ときの Bedrock へのやり直し。Strands はこれを例外にしないので、応答が空のまま終わる。OCR とノートはやり直す
- Batch API での OCR（頼み方の組み立てを分けただけ）
