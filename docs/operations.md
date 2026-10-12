# 運用手順

README から移した、手で打つ運用手順をまとめる。通常のデプロイは main へのマージで GitHub Actions が行うので、
ここに載っているのはワークフローが使えないとき、Actions の対象外のスタック、デプロイ後の確認に限る。

リソース名やアカウント ID はここに書かず、定義元のファイルを示す。`<...>` は手元で置き換える。

## ソムリエ

### Tavily の API キーを登録する（デプロイ前に1回）

キーはリポジトリにも `agentcore.json` にも置かない。[Tavily](https://tavily.com/) でキーを取ってから、先に Secrets Manager へ入れる。
シークレット名は `sommelier/agentcore/agentcore.json` の `TAVILY_API_KEY_SECRET_ID` の値を使う。

```bash
AWS_PROFILE=sakekasu-builder aws secretsmanager create-secret \
  --name <TAVILY_API_KEY_SECRET_ID の値> \
  --secret-string '<Tavily の API キー>' \
  --region ap-northeast-1
```

登録せずにデプロイしても壊れない。キーが読めなければ検索は無効のままで、記録と一般知識だけで相談に答える。

### Runtime のログを見る

Runtime まで届いていたかどうかは CloudWatch Logs で確かめる。Runtime ID は `infra/bin/app.ts` の Runtime ARN の末尾にある。

```bash
AWS_PROFILE=sakekasu-builder aws logs tail \
  /aws/bedrock-agentcore/runtimes/<Runtime ID>-DEFAULT \
  --since 1h --region ap-northeast-1
```

アイドル15分で実行環境が落ちるため、久しぶりの呼び出しは必ず起動ログから始まる。**起動ログすら無ければ、リクエストが Runtime に到達していない**（＝ `auth` か `network`）と判断できる。

### 手でデプロイする

手で打つのは、ワークフローが使えないとき（Actions の障害、ワークフロー自体の修正中）と、`agentcore` CLI でしかできない操作をするとき（`agentcore add` でのリソース追加など）だけ。

```bash
# 1. main を最新にする
#    デプロイされるのは「手元のファイル」であって main の内容ではない。
#    ブランチが古いまま打つと、古い版を本番へ出すことになる
git switch main && git pull

# 2. デプロイ（--target は aws-targets.json の name）
cd sommelier
AWS_PROFILE=sakekasu-builder agentcore deploy --target dev

# 3. cdk/ の依存が勝手に上がっていないか見る（下記）
git status --short sommelier/agentcore/cdk

# 4. 反映を確認（lastUpdatedAt が今なら出ている）
AWS_PROFILE=sakekasu-builder aws bedrock-agentcore-control list-agent-runtimes \
  --region ap-northeast-1 \
  --query "agentRuntimes[?agentRuntimeName=='sommelier_sommelier'].[agentRuntimeVersion,lastUpdatedAt]" \
  --output text
```

`agentcore deploy` は CLI 内部で `.cli/deployed-state.json` を更新する。ワークフロー側は CDK を直接叩くのでこのファイルを書かないが、記録されているのはリソース ID と `deployHash` で、次に手で `agentcore deploy` を打ったときに「変更あり」と判定されて出し直されるだけ。害はない。

#### agentcore deploy は CDK の依存を勝手に上げる

`agentcore deploy` は本体の処理に入る前に `agentcore/cdk` の依存を最新へ書き換えて `npm install` まで走らせる。**CI が確かめた版と、実際にデプロイされる版が別物になりうる**（2026-08-09 のデプロイでは `@aws/agentcore-cdk` が alpha.20 から alpha.45 へ飛び、`Namespaces` が `NamespaceTemplates` に改名されていた）。

デプロイしたら `package.json` と `package-lock.json` の差分を見て、`npm test` を新しい版で通し直す。テストが落ちたらデプロイ済みのものが落ちているということなので、先に中身を確かめる。この自動更新を止めるなら `agentcore config disableDependencyManagement true`。

ワークフローが `agentcore deploy` ではなく CDK を直接叩いているのはこれが理由で、`npm ci` で lock どおりに入れたものをそのまま出す。

#### `npx cdk` は CDK CLI ではない

`sommelier/agentcore/cdk/package.json` は自分自身の `bin.cdk` として CDK アプリ（`dist/bin/cdk.js`）を宣言している。npx は自パッケージの bin を優先するため、**`npx cdk deploy` は CLI ではなくアプリを引数なしで実行して、何もせず成功する**。CLI を使うときは `npx aws-cdk` と書く。

```bash
npx cdk ls        # 何も出力せず終了コード 0（アプリが動いただけ）
npx aws-cdk ls    # AgentCore-sommelier-dev
```

### デプロイ後に好み学習が生きているか確かめる

好み学習はフェイルオープンなので、**動いていなくても画面上は「好みを覚えていないだけ」にしか見えない**。抽出はサービス側の非同期処理で、止まっても何も言わない。デプロイしたら数往復会話してから、レコードが増えているか一度だけ確認する。

```bash
MEMORY_ID=$(AWS_PROFILE=sakekasu-builder aws bedrock-agentcore-control list-memories \
  --region ap-northeast-1 --query "memories[?contains(id,'sommelier_preference')].id | [0]" --output text)

AWS_PROFILE=sakekasu-builder aws bedrock-agentcore list-memory-records \
  --region ap-northeast-1 --memory-id "$MEMORY_ID" \
  --namespace "sommelier/preference/<Cognitoのsub>"
```

抽出は非同期だが、2026-08-09 に確かめたかぎりでは会話の1〜2分後にはレコードが入っていた。空のまましばらく変わらないなら、どちら側が止まっているかで切り分ける。イベント自体が入っていないなら書き込み側（`CreateEvent`）の問題で、Runtime のログに「好みの記録に失敗しました」が出ているはず。

イベントはあるのにレコードが増えないなら抽出側の問題。ここで実行ロールを疑いたくなるが、**疑わなくてよい**。L3 コンストラクトが作る Memory の実行ロールには信頼ポリシーだけで権限ポリシーが1つも付いておらず、それでも抽出は動いている（2026-08-09 に実測）。プロンプトもモデルも差し替えていない素の組み込みストラテジは AWS 側の推論で動くため、`memoryExecutionRoleArn` に Bedrock の権限は要らない（[Customize a built-in strategy or create your own strategy](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-custom-strategy.html) が権限を要求しているのは、組み込みを上書きした場合と自前ストラテジの場合）。

ストラテジを上書きするよう変えたときは話が別で、そのときは実行ロール（`AgentCore-sommelier-dev` スタックが作る `...MemoryPreferenceExecutionRole...`）に `AmazonBedrockAgentCoreMemoryBedrockModelInferenceExecutionRolePolicy` が要る。

## 毎日の利用料金 Slack 通知（管理アカウント）

`sakekasu-billing-notifier` は Actions の対象外で、管理アカウントへ手でデプロイする。Webhook URL を入れる SSM パラメータの名前は `infra/lib/billing-notifier-stack.ts` にある。

```bash
# 1. 管理アカウントの認証情報で入っていることを確認し、その ID を控える（以降の手順で使う）
BILLING_ACCOUNT_ID=$(AWS_PROFILE=<管理アカウントのプロファイル> aws sts get-caller-identity --query Account --output text)
echo "$BILLING_ACCOUNT_ID"

# 2. （初回のみ）管理アカウントを CDK bootstrap する
cd infra
AWS_PROFILE=<管理アカウントのプロファイル> npx cdk bootstrap aws://$BILLING_ACCOUNT_ID/ap-northeast-1 -c billing=true -c billingAccount=$BILLING_ACCOUNT_ID

# 3. Slack の Incoming Webhook URL を管理アカウント側に登録する
AWS_PROFILE=<管理アカウントのプロファイル> aws ssm put-parameter \
  --name <billing-notifier が読むパラメータ名> \
  --type SecureString \
  --value '<Slack の Incoming Webhook URL>' \
  --region ap-northeast-1

# 4. デプロイ（内訳に出すアプリ本体のアカウントの ID も、リポジトリに書かず渡す）
APP_ACCOUNT_ID=$(AWS_PROFILE=sakekasu-builder aws sts get-caller-identity --query Account --output text)
AWS_PROFILE=<管理アカウントのプロファイル> npx cdk deploy sakekasu-billing-notifier -c billing=true \
  -c billingAccount=$BILLING_ACCOUNT_ID -c appAccount=$APP_ACCOUNT_ID

# 5. 動作確認（手動で1回実行して Slack に届くか見る）
AWS_PROFILE=<管理アカウントのプロファイル> aws lambda invoke \
  --function-name sakekasu-billing-notifier \
  --region ap-northeast-1 /dev/stdout
```

## DevOps Agent のクロスアカウントロール

`agentSpaceArn` があるときだけスタックが合成される。Actions では secret `AGENT_SPACE_ARN` から入る。手元で差分を見るときなどは次のように渡す。

```bash
cd infra
AWS_PROFILE=sakekasu-builder npx cdk deploy sakekasu-dev-devops-agent -c env=dev \
  -c agentSpaceArn=<Agent Space の ARN>
```

セットアップの全体は [devops-agent.md](devops-agent.md) にある。

## OIDC 連携の初回セットアップ（1回だけ手動）

`sakekasu-github-oidc` は Actions に自分のロールを触らせないため、手でデプロイする。

```bash
cd infra
AWS_PROFILE=sakekasu-builder npx cdk deploy sakekasu-github-oidc -c github-oidc=true
```

これで OIDC プロバイダーと deploy / diff ロール、それに cdkd 用のデプロイロールが作られ、以後 Actions が動くようになる。

## 後片付け

監視の送り先を共通基盤へ移す前に builder が読んでいた Slack Webhook URL の SSM パラメータは、もう読まれていない。
残っていれば消してよい。
