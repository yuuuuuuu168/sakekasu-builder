# cdkd（CDK Direct）への移行手順

GitHub Actions の CDK デプロイを、CloudFormation を経由しない [cdkd](https://github.com/go-to-k/cdkd) に置き換えるための作業メモ（[#150](https://github.com/yuuuuuuu168/sakekasu-builder/issues/150)）。

cdkd は CDK アプリを CloudFormation ではなく AWS SDK / Cloud Control API で直接デプロイする CLI。CDK のコードは変更不要で、`cdk deploy` を `cdkd deploy` に置き換えるだけで動く。

このファイルは AWS 側の作業手順そのもので、コードの変更だけでは移行は完了しない。

## 現在どこまで進んでいるか

| 手順 | 内容 | 状態 |
| --- | --- | --- |
| 1 | infra に `@go-to-k/cdkd` を追加 | 済 |
| 2 | cdkd 用のデプロイロールを `GithubOidcStack` に追加 | 済（デプロイは未） |
| 3 | OIDC スタックを手動デプロイして新ロールを作る | これから |
| 4 | `cdkd bootstrap` | これから |
| 5 | `cdkd diff --all` で未対応リソースを洗い出す | これから |
| 6 | 影響の小さいスタックで CFn への戻しを確認 | これから |
| 7 | `cdkd import` で既存スタックを取り込む | これから |
| 8 | `cdkd drift` で state と実物の一致を確認 | これから |
| 9 | `deploy.yml` / `cdk-diff.yml` を cdkd に差し替え | これから（別 PR） |

手順9を先にマージしてはいけない。取り込み（手順7）が済んでいない状態で cdkd が走ると、state が空なので既存リソースの存在を知らないまま全部を新規作成しにいく。DynamoDB テーブルや Cognito UserPool が二重にできるか、名前の衝突で途中まで作って落ちる。

## 先に片付けること

[#129](https://github.com/yuuuuuuu168/sakekasu-builder/issues/129)（`logRetention` → `logGroup`）を先に済ませる。

移行対象のスタックには `Custom::LogRetention` が6個ある（api 2 / auth 1 / monitoring 3）。取り込みは問題なく通るが、CloudFormation へ戻すときに引っかかる。CFn は Lambda 実装のカスタムリソースを IMPORT できないため、`cdkd export --include-non-importable` による2フェーズ移行（フェーズ2で CFn が再 CREATE し、`onCreate` が呼び直される）が必要になる。#129 が終われば `Custom::LogRetention` そのものが消えるので、戻し手順が素直になる。

## 移行対象

`deploy.yml` が `cdk deploy --all` で流しているスタック。`-c env=dev` は `cdk.json` の context 既定値。

- `sakekasu-dev-auth`
- `sakekasu-dev-api`
- `sakekasu-dev-monitoring`
- `sakekasu-dev-health-global`（us-east-1）

`sakekasu-dev-devops-agent` は `agentSpaceArn` の context が入っているときだけ合成される。いまは入っていないため `cdkd list` にも出ないが、入れた時点で同じ扱いになる。

`sakekasu-github-oidc` と `sakekasu-billing-notifier` は Actions からデプロイしていない手動専用スタックなので対象外。とくに `sakekasu-github-oidc` を cdkd 化すると自分を締め出す事故につながるため、CDK CLI のまま残す。

### リソースの対応状況

`cdkd list` が合成する4スタックのリソースを、cdkd の [supported-resources.md](https://github.com/go-to-k/cdkd/blob/main/docs/supported-resources.md) と突き合わせた結果。

| リソース | 個数 | cdkd での扱い |
| --- | --- | --- |
| AppSync GraphQLApi / Schema / DataSource / Resolver | 22 | SDK Provider |
| CloudWatch Alarm | 22 | SDK Provider |
| IAM Role / Policy | 28 | SDK Provider |
| Lambda Function / Permission | 13 | SDK Provider |
| DynamoDB Table | 2 | SDK Provider |
| Cognito UserPool | 1 | SDK Provider |
| Events Rule | 4 | SDK Provider |
| SNS Topic / Subscription / TopicPolicy | 3 | SDK Provider |
| S3 Bucket | 1 | SDK Provider |
| Custom::LogRetention | 6 | SDK Provider |
| AppSync FunctionConfiguration | 4 | 一覧になし → Cloud Control API |
| Cognito UserPoolClient | 2 | 同上 |
| Logs MetricFilter | 2 | 同上 |

対応表に無い型は Cloud Control API へ自動でフォールバックする。実際に通るかは手順5の `cdkd diff` で分かる。cdkd は未対応のプロパティを pre-flight で検出して落ちる作りになっている。

AppSync の認証は Cognito UserPool のみで API Key を使っていないため、CloudFormation が import できない型として名指しされている `AWS::AppSync::ApiKey` は該当しない。

## ロールの構成

cdkd は CloudFormation を通さないため、CDK bootstrap が作る `cdk-hnb659fds-*` ロールは使えない。デプロイする identity 自身が、作るリソース全部の操作権限を持っている必要がある。

```
GitHub Actions（main への push）
  └─ OIDC → sakekasu-github-actions-deploy   ← 実権限を持たない
       ├─ AssumeRole → cdk-hnb659fds-*       ← 移行が終わるまで残す
       └─ AssumeRole → sakekasu-cdkd-deploy  ← 強い権限はここだけ
```

ランナー自身の認証情報に強い権限を持たせず、`--role-arn`（環境変数なら `CDKD_ROLE_ARN`）で `sakekasu-cdkd-deploy` に入って使う。npm の依存が乗っ取られてインストール時スクリプトが走っても、掴めるのは「AssumeRole しかできないロール」のセッショントークンになる。

権限の中身は `infra/lib/cdkd-policies.ts` にある。AdministratorAccess は貼らず、このアプリが実際に使っているサービスに絞ってある。絞り方は「その権限で利用者のデータが読めるか」で分けていて、DynamoDB のレコード、Cognito の利用者、S3 の画像、CloudWatch Logs の中身には届かない。

## 手順

以下はすべて `infra/` で実行する。プロファイルは `sakekasu-builder`（アカウント <アプリのアカウント ID>）。

### 3. OIDC スタックを手動デプロイする

```bash
cd infra
AWS_PROFILE=sakekasu-builder npx cdk deploy sakekasu-github-oidc -c github-oidc=true
```

`sakekasu-cdkd-deploy` が作られ、`sakekasu-github-actions-deploy` からそこへ入れるようになる。出力の `CdkdDeployRoleArn` を控えておく。

### 4. cdkd bootstrap

`cdk bootstrap` とは別物で、既存の bootstrap には影響しない。

```bash
AWS_PROFILE=sakekasu-builder AWS_REGION=ap-northeast-1 npx cdkd bootstrap
AWS_PROFILE=sakekasu-builder AWS_REGION=us-east-1 npx cdkd bootstrap
```

1回目で state バケット `cdkd-state-<アプリのアカウント ID>` と ap-northeast-1 のアセットストレージが、2回目で us-east-1（`sakekasu-dev-health-global` 用）のアセットストレージができる。2回目を省いても初回デプロイ時に自動で作られるが、事前に作っておいたほうが挙動が読みやすい。

### 5. pre-flight の確認

```bash
AWS_PROFILE=sakekasu-builder npx cdkd diff --all
```

この時点では state が空なので、全リソースが「作成」として出るのが正常。見るのは差分の中身ではなく、未対応の型や未実装プロパティのエラーが出ないかどうか。とくに Cloud Control にフォールバックする AppSync FunctionConfiguration / Cognito UserPoolClient / Logs MetricFilter。

エラーが出た場合、`--allow-unsupported-properties` という逃げ道はあるが、そのプロパティは AWS に書かれないまま無視される。安易に付けない。

### 6. CloudFormation へ戻せることを先に確認する

戻せない状態で本移行に入らない。いちばん小さい `sakekasu-dev-health-global`（4リソース、カスタムリソースなし）で往復を確認する。

```bash
# 取り込む
AWS_PROFILE=sakekasu-builder npx cdkd import sakekasu-dev-health-global \
  --migrate-from-cloudformation --dry-run
AWS_PROFILE=sakekasu-builder npx cdkd import sakekasu-dev-health-global \
  --migrate-from-cloudformation --yes

# CloudFormation へ戻す
AWS_PROFILE=sakekasu-builder npx cdkd export sakekasu-dev-health-global --dry-run
AWS_PROFILE=sakekasu-builder npx cdkd export sakekasu-dev-health-global
```

`export` は CFn の IMPORT チェンジセットを使うので、AWS のリソースは作り直されない。成功すると cdkd 側の state は消える。

### 7. 既存スタックの取り込み

依存の末端から順に。api は auth に、monitoring は api に、health-global は monitoring に依存している。

```bash
for stack in sakekasu-dev-auth sakekasu-dev-api sakekasu-dev-monitoring sakekasu-dev-health-global; do
  AWS_PROFILE=sakekasu-builder npx cdkd import "$stack" \
    --migrate-from-cloudformation \
    --record-resource-mapping "mapping-$stack.json" \
    --dry-run
done
```

`--dry-run` で解決結果を確認してから、`--dry-run` を外して `--yes` を付けて1つずつ流す。`--record-resource-mapping` で書き出した論理 ID と物理 ID の対応表は、後から「何を取り込んだか」を追うときに要る。

リソースは再作成されない。`--migrate-from-cloudformation` は、CFn の全リソースに `DeletionPolicy: Retain` と `UpdateReplacePolicy: Retain` を注入する UpdateStack を打ってから DeleteStack する。スタックの記録だけが消えて、実体は残る。

移行途中は cdkd 管理と CFn 管理が混在するが、`Fn::ImportValue` は cdkd の state に無ければ CloudFormation の Exports にフォールバックするため、参照は解決される。

### 8. drift の確認

各スタックの取り込み直後に流す。

```bash
AWS_PROFILE=sakekasu-builder npx cdkd drift sakekasu-dev-auth
```

差分がなければ終了コード 0。出た場合は `cdkd drift <stack> --json` で中身を見る。state を実物に合わせるなら `--accept`、実物を state に合わせるなら `--revert`。

### 9. ワークフローの差し替え

手順8まで全部クリーンになってから、別 PR で `deploy.yml` と `cdk-diff.yml` を差し替える。

- `npx cdk deploy --all --require-approval never` → `npx cdkd deploy --all --yes`
- `npx cdk diff --all --no-color` → `npx cdkd diff --all`（cdkd に `--no-color` は無いので `NO_COLOR=1` を渡す）
- `CDKD_ROLE_ARN` に `arn:aws:iam::<アプリのアカウント ID>:role/sakekasu-cdkd-deploy` を入れる
- `cdk-diff.yml` の diff ロールは `cdk-hnb659fds-lookup-role-*` への AssumeRole を消す（cdkd では使わない。読み取り権限は手順3の時点で付与済み）
- 待ちモードは既定のまま。デプロイ後にカナリアとアラームが動く構成なので `--no-wait` は使わない

## 運用コマンドの対応

CloudFormation のスタックが無くなるので、コンソールのスタックビューは使えなくなる。

| 用途 | いままで | これから |
| --- | --- | --- |
| 差分の確認 | `cdk diff --all` | `cdkd diff --all` |
| デプロイ | `cdk deploy --all` | `cdkd deploy --all --yes` |
| スタック一覧 | CFn コンソール | `cdkd state list` |
| リソース一覧 | CFn コンソールのリソースタブ | `cdkd state resources <stack>` |
| スタックの中身 | CFn のテンプレート | `cdkd state show <stack>` |
| デプロイ履歴 | CFn のイベント | `cdkd events <stack>` |
| ドリフト検出 | CFn のドリフト検出 | `cdkd drift <stack>` |
| ロールバック | CFn の自動ロールバック | `cdkd rollback <stack>` |
| ロック解除 | 不要 | `cdkd force-unlock <stack>` |

state の置き場所は `s3://cdkd-state-<アプリのアカウント ID>/cdkd/<stack>/<region>/state.json`。

## CloudFormation に戻す

問題が起きたら、スタック単位で CFn へ戻せる。リソースは作り直されない。

```bash
cd infra
AWS_PROFILE=sakekasu-builder npx cdkd export sakekasu-dev-api --dry-run
AWS_PROFILE=sakekasu-builder npx cdkd export sakekasu-dev-api
```

`Custom::LogRetention` が残っているスタック（#129 が未完のとき）は、そのままだと「CFn が IMPORT できない型がある」として中断する。その場合は2フェーズ移行を使う。

```bash
AWS_PROFILE=sakekasu-builder npx cdkd export sakekasu-dev-api --include-non-importable
```

フェーズ1で import できるリソースを取り込み、フェーズ2で CFn がカスタムリソースを CREATE する。CREATE のときに `onCreate` が呼び直されるが、CDK の LogRetention は `PutRetentionPolicy` を呼ぶだけなので、何度実行しても結果は変わらない。

戻したあとは `deploy.yml` を `cdk deploy` に戻し、`sakekasu-github-actions-deploy` から `cdk-hnb659fds-*` への AssumeRole が残っていることを確認する（移行が完了するまで消さない理由がこれ）。

## 注意点

`--prefix-user-supplied-names` は付けない。このリポジトリは `tableName` / `functionName` / `bucketName` / `alarmName` などを明示指定しているため、このフラグを付けるとスタック名が接頭辞として付き、リソース名が変わって作り直しになる。cdkd の既定（接頭辞を付けない）が CloudFormation と同じ挙動。

デプロイの同時実行はスタック単位のロックで防がれる。ジョブが途中でキャンセルされるとロックが残るが、30分の TTL で自動解除される。すぐ解除したいときは `cdkd force-unlock <stack>`。

state バケットには合成後のプロパティが入るため、`{{resolve:secretsmanager:...}}` のような動的参照が解決済みの平文で残りうる。`cdkd scrub --dry-run --fail` で検出できる。CI のゲートに入れるかは移行後に判断する。

cdkd 自体はまだ 0.x で、公式に「dev/test 用。production-ready ではない」と明記されている。本番相当の環境には CDK CLI を使うことが推奨されている。この移行はそれを承知のうえで進めている。

## 権限が足りなかったとき

`sakekasu-cdkd-deploy` は必要なサービスに絞ってあるため、取り込みやデプロイの途中で `AccessDenied` が出ることがある。

1. エラーメッセージから足りないアクションを特定する
2. `infra/lib/cdkd-policies.ts` の該当ステートメントに足す
3. `npx cdk deploy sakekasu-github-oidc -c github-oidc=true` で反映する
4. `npx cdkd deploy --dry-run --role-arn arn:aws:iam::<アプリのアカウント ID>:role/sakekasu-cdkd-deploy` で確認する

面倒でも AdministratorAccess を貼らずにこの手順を回す。貼った瞬間に「main への push から到達できる管理者権限」がひとつ増える。

インラインポリシーには 10,240 バイトの上限がある。現状は約 4.1KB なので当面は足していけるが、上限に近づいたらマネージドポリシーに分ける。
