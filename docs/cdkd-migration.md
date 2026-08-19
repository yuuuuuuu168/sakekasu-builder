# cdkd（CDK Direct）への移行手順

GitHub Actions の CDK デプロイを、CloudFormation を経由しない [cdkd](https://github.com/go-to-k/cdkd) に置き換えるための作業メモ（[#150](https://github.com/yuuuuuuu168/sakekasu-builder/issues/150)）。

cdkd は CDK アプリを CloudFormation ではなく AWS SDK / Cloud Control API で直接デプロイする CLI。CDK のコードは変更不要で、`cdk deploy` を `cdkd deploy` に置き換えるだけで動く。

このファイルは AWS 側の作業手順そのもので、コードの変更だけでは移行は完了しない。

## 現在どこまで進んでいるか

| 手順 | 内容 | 状態 |
| --- | --- | --- |
| 1 | infra に `@go-to-k/cdkd` を追加 | 済 |
| 2 | cdkd 用のデプロイロールと Permissions Boundary を `GithubOidcStack` に追加 | 済（コード） |
| 3 | OIDC スタックを手動デプロイしてロールと境界を作る | 要・再実行 |
| 3.5 | `cdk deploy --all` でアプリの全ロールに境界を付ける | これから |
| 4 | `cdkd bootstrap` | 済 |
| 5 | `cdkd diff --all` で未対応リソースを洗い出す | 済・クリーン |
| 6 | 影響の小さいスタックで CFn への戻しを確認 | これから |
| 7 | `cdkd import` で既存スタックを取り込む | これから |
| 8 | `cdkd drift` で state と実物の一致を確認 | これから |
| 9 | `deploy.yml` / `cdk-diff.yml` を cdkd に差し替え | これから（別 PR） |

手順3は一度実行済みだが、セキュリティレビューを受けて Permissions Boundary を足したため、もう一度流す必要がある。

### 順番を外すと止まるところ

**OIDC スタック（手順3）を、アプリのスタックより先にデプロイする。** アプリの全ロールが `sakekasu-role-boundary` を参照するようになったので、境界ポリシーが存在しない状態で `cdk deploy --all` を打つと、存在しないポリシーを指しているとして CloudFormation が落ちる。

**手順7を始めたら、手順9のマージまで `infra/**` を main に入れない。** `cdkd import --migrate-from-cloudformation` は CloudFormation のスタックを削除する（リソースは Retain で残る）。その状態でいまの `deploy.yml`（`cdk deploy --all`）が走ると、スタックが消えている以上ゼロから作り直そうとして、既存リソースと名前がぶつかる。取り込みから差し替えまでの窓は短いほどよい。手順9の PR を先に用意しておき、取り込みが終わったらすぐマージする。

**手順9を先にマージしない。** 取り込みが済んでいない状態で cdkd が走ると、state が空なので既存リソースの存在を知らないまま全部を新規作成しにいく。

## 先に片付けること

[#129](https://github.com/yuuuuuuu168/sakekasu-builder/issues/129)（`logRetention` → `logGroup`）は**完了済み**。2026-08-18 に dev の3スタックへ反映し、`Custom::LogRetention` は6個とも消えた（経緯は [log-group-import.md](log-group-import.md)）。

これで CloudFormation へ戻すときの障害がひとつ減った。CFn は Lambda 実装のカスタムリソースを IMPORT できないため、`Custom::LogRetention` が残っていると `cdkd export --include-non-importable` による2フェーズ移行（フェーズ2で CFn が再 CREATE し、`onCreate` が呼び直される）が要る。いまはその必要が無い。

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
| IAM Role / Policy | 22 | SDK Provider |
| Lambda Function / Permission | 10 | SDK Provider |
| DynamoDB Table | 2 | SDK Provider |
| Cognito UserPool | 1 | SDK Provider |
| Events Rule | 4 | SDK Provider |
| SNS Topic / Subscription / TopicPolicy | 3 | SDK Provider |
| S3 Bucket | 1 | SDK Provider |
| Logs LogGroup | 6 | SDK Provider |
| AppSync FunctionConfiguration | 4 | 一覧になし → Cloud Control API |
| Cognito UserPoolClient | 2 | 同上 |
| Logs MetricFilter | 2 | 同上 |
| ApplicationSignals ServiceLevelObjective | 2 | 同上（Issue #86 で追加） |

対応表に無い型は Cloud Control API へ自動でフォールバックする。実際に通るかは手順5の `cdkd diff` で分かる。cdkd は未対応のプロパティを pre-flight で検出して落ちる作りになっている。

**Cloud Control API へフォールバックする型でも、その先のサービス権限は要る。** SLO であれば `applicationsignals:CreateServiceLevelObjective` が呼ばれるので、`UseCloudControlApi` の `cloudformation:CreateResource` だけでは足りない。デプロイロールとは別に、**diff ロールにも読み取りの権限が要る**（`cdkd diff` は既存の状態を Cloud Control 経由で読む）。Cognito UserPoolClient に `cognito-idp:DescribeUserPoolClient` を足してあるのと同じ形。

**サービス単位のワイルドカードにはしない。** `applicationsignals:*` にすると `StartDiscovery`（サービス検出の有効化）が入る。これはアカウントに1つの設定で、スタックから意図的に外して守っているもの。IAM の側から素通りで触れる形にすると、スタックの守りが意味を失う。`ManageServiceLevelObjectives` で SLO の操作だけを列挙し、`StartDiscovery` は Deny でも塞いである。

**リソースの型を増やしたときは、この対応表と両ロールの権限を合わせて見直すこと。** 足りない操作が出たときはデプロイか diff が AccessDenied で落ちるので、落ちてから足せばよい。分からないまま広い権限を渡すよりよい。

AppSync の認証は Cognito UserPool のみで API Key を使っていないため、CloudFormation が import できない型として名指しされている `AWS::AppSync::ApiKey` は該当しない。

## ロールの構成

cdkd は CloudFormation を通さないため、CDK bootstrap が作る `cdk-hnb659fds-*` ロールは使えない。デプロイする identity 自身が、作るリソース全部の操作権限を持っている必要がある。

```
GitHub Actions（main への push）
  └─ OIDC → sakekasu-github-actions-deploy   ← 実権限を持たない
       ├─ AssumeRole → cdk-hnb659fds-*       ← 移行が終わるまで残す
       └─ AssumeRole → sakekasu-cdkd-deploy  ← 強い権限はここだけ
                          │
                          └─ 作れるのは sakekasu-role-boundary の内側のロールだけ
```

ランナー自身の認証情報に強い権限を持たせず、`--role-arn`（環境変数なら `CDKD_ROLE_ARN`）で `sakekasu-cdkd-deploy` に入って使う。npm の依存が乗っ取られてインストール時スクリプトが走っても、掴めるのは「AssumeRole しかできないロール」のセッショントークンになる。

権限の中身は `infra/lib/cdkd-policies.ts` にある。AdministratorAccess は貼らず、このアプリが実際に使っているサービスに絞ってある。絞り方は「その権限で利用者のデータが読めるか」で分けていて、DynamoDB のレコード、Cognito の利用者、S3 の画像、CloudWatch Logs の中身には届かない。

### Permissions Boundary

ロール名を `sakekasu-*` に絞るだけでは、権限昇格が塞げない。Lambda の実行ロールは自動生成名がスタック名で始まるためこの範囲に入り、そこへ管理者相当のインラインポリシーを書き込んで、そのロールを使う関数を呼べば任意の API を叩けてしまう。PR #151 のセキュリティレビューで指摘された経路がこれ。

対策として、アプリのスタックが作るロール全部に `sakekasu-role-boundary` を付けている（`infra/lib/role-boundary.ts`）。境界は「許可の上限」なので、ロールの実効権限は「自身のポリシー ∩ 境界」になる。境界が `iam:*` と `sts:*` を拒否している限り、書き込まれた管理者相当は効かない。

cdkd 側は、権限を増やしうる IAM の API（`CreateRole` / `PutRolePolicy` / `AttachRolePolicy` / `PutRolePermissionsBoundary` など）を `iam:PermissionsBoundary` の条件付きにしてある。境界の無いロールは作れず、境界を外すこともできない。

条件キーを付ける場所には制約があるので、触るときは注意する。

- `iam:PassedToService` は `PassRole` 専用。他のアクションと同じステートメントに入れると、そちらが常に拒否される
- `iam:PermissionsBoundary` は `CreateRole` / `DeleteRole` / `PutRolePolicy` / `DeleteRolePolicy` / `AttachRolePolicy` / `DetachRolePolicy` / `PutRolePermissionsBoundary` で使える。`TagRole` や `UpdateRole` には効かないので、付けると恒久的な AccessDenied になる

境界を外すのは管理者の仕事で、デプロイ用の identity からは切り離してある。手で外す必要が出たときは、人間様のプロファイルで `cdk deploy sakekasu-github-oidc` を打つ。

## 手順

以下はすべて `infra/` で実行する。プロファイルは `sakekasu-builder`（アカウント <アプリのアカウント ID>）。

### 3. OIDC スタックを手動デプロイする

```bash
cd infra
AWS_PROFILE=sakekasu-builder npx cdk deploy sakekasu-github-oidc -c github-oidc=true
```

`sakekasu-cdkd-deploy` と `sakekasu-role-boundary` が作られ、`sakekasu-github-actions-deploy` からそこへ入れるようになる。出力の `CdkdDeployRoleArn` と `RoleBoundaryArn` を控えておく。

アプリのスタックより先にこれを流す。境界が存在しない状態でアプリをデプロイすると、存在しないポリシーを参照しているとして落ちる。

### 3.5. アプリの全ロールに境界を付ける

```bash
AWS_PROFILE=sakekasu-builder npx cdk diff --all -c env=dev
AWS_PROFILE=sakekasu-builder npx cdk deploy --all -c env=dev
```

14個のロールに `PermissionsBoundary` が付くだけの差分になるはず。ロールの作り直しは発生しない。

PR をマージすると `deploy.yml` が同じことをするので、手順3を先に済ませてあれば、この手順はマージで自動的に済む。

### 4. cdkd bootstrap

`cdk bootstrap` とは別物で、既存の bootstrap には影響しない。

```bash
AWS_PROFILE=sakekasu-builder AWS_REGION=ap-northeast-1 npx cdkd bootstrap
AWS_PROFILE=sakekasu-builder AWS_REGION=us-east-1 npx cdkd bootstrap
```

1回目で state バケット `cdkd-state-<アプリのアカウント ID>` と ap-northeast-1 のアセットストレージが、2回目で us-east-1（`sakekasu-dev-health-global` 用）のアセットストレージができる。2回目は state バケットがすでにあるため再設定はスキップされる。

実行済み（2026-08-16）。両リージョンとも成功し、`cdkd state info` でアセットストレージが2リージョン分できていることを確認した。

アセットの置き場所が CDK bootstrap のバケットから `cdkd-assets-<アプリのアカウント ID>-*` に変わるため、取り込み後の最初の `cdkd deploy` で Lambda のコード参照に一度だけ UPDATE が出る。中身は同じで、リソースの作り直しではない。

### 5. pre-flight の確認

```bash
AWS_PROFILE=sakekasu-builder npx cdkd diff --all
```

この時点では state が空なので、全リソースが「作成」として出るのが正常。見るのは差分の中身ではなく、未対応の型や未実装プロパティのエラーが出ないかどうか。とくに Cloud Control にフォールバックする AppSync FunctionConfiguration / Cognito UserPoolClient / Logs MetricFilter。

エラーが出た場合、`--allow-unsupported-properties` という逃げ道はあるが、そのプロパティは AWS に書かれないまま無視される。安易に付けない。

実行済み（2026-08-16）。4スタックすべてが処理され、未対応の型もプロパティも出なかった。件数は auth 12 / api 49 / monitoring 46 / health-global 3 で、合成したリソース数から `AWS::CDK::Metadata` を引いた数と一致する。Cloud Control にフォールバックする3種類も一覧に出たうえで何も言われていない。移行の前提は満たされている。

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

PR は取り込み（手順7）より先に用意しておき、手順8まで全部クリーンになったらすぐマージする。取り込みから差し替えまでの間は `cdk deploy --all` と実体がずれた状態になるため、窓を開けたままにしない。

- `npx cdk deploy --all --require-approval never` → `npx cdkd deploy --all --yes`
- `npx cdk diff --all --no-color` → `npx cdkd diff --all`（cdkd に `--no-color` は無いので `NO_COLOR=1` を渡す）
- `CDKD_ROLE_ARN` に `arn:aws:iam::<アプリのアカウント ID>:role/sakekasu-cdkd-deploy` を入れる
- `cdk-diff.yml` の diff ロールは `cdk-hnb659fds-lookup-role-*` への AssumeRole を消す（cdkd では使わない。読み取り権限は手順3の時点で付与済み）
- 待ちモードは既定のまま。デプロイ後にカナリアとアラームが動く構成なので `--no-wait` は使わない

あわせて、セキュリティレビュー（PR #151）で挙がった2件をここで入れる。

**合成と差分を分ける。** いまの `cdk-diff.yml` は認証情報を入れたあとに `cdk diff` を走らせている。`--ignore-scripts` は npm のインストール時スクリプトを止めるが、CDK アプリのコードは合成時に実行されるため、PR に AWS SDK の呼び出しを仕込めば認証情報付きで動く。cdkd も CDK CLI も合成済みのアセンブリを `--app cdk.out` で受け取れるので、認証情報を入れる前に `synth` を済ませ、そのあと差分だけを取る形にする。これで PR のコードが認証情報に触れる経路が消える（[#131](https://github.com/yuuuuuuu168/sakekasu-builder/issues/131) にも効く）。

**state に平文が残っていないか見張る。** `npx cdkd scrub --dry-run --fail` をデプロイ前のゲートに入れる。現状このアプリの合成テンプレートに `{{resolve:secretsmanager:...}}` は無く、シークレットは ID を環境変数に置いて実行時に取りに行く作りなので平文が残る余地は無いが、将来そうなったときに気づけるようにしておく。

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

`Custom::LogRetention` が残っているスタックは、そのままだと「CFn が IMPORT できない型がある」として中断する。その場合は2フェーズ移行を使う。dev の3スタックからは #129 で消えているので、いまは当たらない。

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
