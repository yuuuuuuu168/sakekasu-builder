# cdkd（CDK Direct）への移行手順

GitHub Actions の CDK デプロイを、CloudFormation を経由しない [cdkd](https://github.com/go-to-k/cdkd) に置き換えるための作業メモ（[#150](https://github.com/yuuuuuuu168/sakekasu-builder/issues/150)）。

cdkd は CDK アプリを CloudFormation ではなく AWS SDK / Cloud Control API で直接デプロイする CLI。CDK のコードは変更不要で、`cdk deploy` を `cdkd deploy` に置き換えるだけで動く。

このファイルは AWS 側の作業手順そのもので、コードの変更だけでは移行は完了しない。

## 現在どこまで進んでいるか

| 手順 | 内容 | 状態 |
| --- | --- | --- |
| 1 | infra に `@go-to-k/cdkd` を追加 | 済 |
| 1.5 | cdkd を 0.291.31 に上げる | 済 |
| 2 | cdkd 用のデプロイロールと Permissions Boundary を `GithubOidcStack` に追加 | 済（コード） |
| 3 | OIDC スタックを手動デプロイしてロールと境界を作る | 済 |
| 3.5 | `cdk deploy --all` でアプリの全ロールに境界を付ける | 済 |
| 4 | `cdkd bootstrap` | 済 |
| 5 | `cdkd diff --all` で未対応リソースを洗い出す | 済 |
| 5.5 | 取り込みを回す `migrate-to-cdkd.sh` を書く | 済 |
| 6 | 影響の小さいスタックで CFn への戻しを確認 | 済（要・回避策） |
| 7 | `cdkd import` で既存スタックを取り込む | 済（2026-10-03。4スタックとも失敗0） |
| 8 | `cdkd drift` で state と実物の一致を確認 | 済（2026-10-03。差分は文字化けのみ） |
| 9 | `deploy.yml` / `cdk-diff.yml` を cdkd に差し替え | PR 用意済み（マージ前に下の「取りこぼした4リソース」を取り込む） |

手順3と3.5 は 2026-10-03 に完了を確認した。`sakekasu-cdkd-deploy` ロールと `sakekasu-role-boundary` ポリシーはどちらも 2026-08-16 付で実在し、境界の `PermissionsBoundaryUsageCount` は 13。合成した4スタックの IAM ロール数（api 8 / auth 1 / monitoring 3 / health-global 1 = 13）と一致するので、全ロールに境界が付いている。

その後、AWS Health の通知を共通基盤へ移したので `sakekasu-dev-health-global` はアプリから外した（下の「health-global を外した」）。このファイルの「4スタック」「ロール13」などの数字は外す前のもので、手順の記録としてそのまま残してある。

境界を適用するコード（`0490e66`）が main に入ったあと、`deploy` ワークフローの `cdk deploy --all` は 9/15・9/26・10/2 と3回成功している。境界ポリシーが無ければ IAM 側で落ちるため、これも傍証になる。

### 順番を外すと止まるところ

**OIDC スタック（手順3）を、アプリのスタックより先にデプロイする。** アプリの全ロールが `sakekasu-role-boundary` を参照するようになったので、境界ポリシーが存在しない状態で `cdk deploy --all` を打つと、存在しないポリシーを指しているとして CloudFormation が落ちる。

**手順7を始めたら、手順9のマージまで `infra/**` を main に入れない。** `cdkd import --migrate-from-cloudformation` は CloudFormation のスタックを削除する（リソースは Retain で残る）。その状態でいまの `deploy.yml`（`cdk deploy --all`）が走ると、スタックが消えている以上ゼロから作り直そうとして、既存リソースと名前がぶつかる。取り込みから差し替えまでの窓は短いほどよい。手順9の PR を先に用意しておき、取り込みが終わったらすぐマージする。

**手順9を先にマージしない。** 取り込みが済んでいない状態で cdkd が走ると、state が空なので既存リソースの存在を知らないまま全部を新規作成しにいく。

## cdkd の版と、先行リポジトリで判明している不具合

同じアカウントで動かしている他の2本が先に cdkd へ移行した。踏んだ不具合と回避がそちらに残っているので、こちらは書き写せばよい。

| リポジトリ | cdkd | 移行の回し方 |
| --- | --- | --- |
| [sakekasu-kakeibo](https://github.com/yuuuuuuu168/sakekasu-kakeibo) | 0.291.16 | deploy ワークフローが毎回 `migrate-to-cdkd.sh` を呼ぶ。人が打つものは無い |
| [sakekasu-learning](https://github.com/yuuuuuuu168/sakekasu-learning) | 0.291.16 | 手元で `cdkd-stacks.sh migrate` を打つ |
| sakekasu-builder | 0.291.31 | これから決める |

**版を 0.291.16 に揃えなかった。** 他2本が踏んだ不具合のうち1件は 0.291.23 で直っている（[#3701](https://github.com/go-to-k/cdkd/issues/3701) `complete a bare CloudFormation id to the Cloud Control composite identifier`）。16 に固定すると、上流で直っているものに対して回避コードを新しく書くことになる。揃える先は「他2本がたまたま使っていた版」ではなく最新とし、他2本は後から追随して回避を1つ落とせばよい。

判明している不具合は3件。どれもこのリポジトリに当たる。1件目は先行リポジトリ由来、2件目は手順7 の前検査、3件目は手順6 でこちらが踏んだ。どれも未修正で回避が要る。

**リージョンの取り違え（未修正。回避が要る）。** `cdkd import` は CloudFormation を読むクライアントを実行時の `AWS_REGION` で作り、スタックのリージョンを見ない。us-east-1 のスタックを ap-northeast-1 から探して、全リソースが「not found」になる。0.291.31 の `cdkd import --help` を見ても `--stack-region` に当たるオプションは無いので、スタックごとに `AWS_REGION` を合わせて打つしかない。

このリポジトリで当たるのは `sakekasu-dev-health-global`（us-east-1）。手順6 はそのスタックで往復を確認する手順なので、回避を入れないまま打つと最初の一手が分かりにくい形で落ちる。

**物理 ID と Cloud Control の識別子の食い違い（未修正。回避が要る）。** cdkd は取り込むリソースの識別子に CloudFormation の物理 ID を使うが、Cloud Control 側が別の形を求める型がある。そのままだと `Identifier ... is not valid for identifier [...]` で落ちる。2026-10-03 の手順7 の前検査で3型・5件に当たった。

| 型 | 要る識別子 | 物理 ID | 件数 |
| --- | --- | --- | --- |
| `AWS::Cognito::UserPoolClient` | `<UserPoolId>\|<ClientId>` | ClientId だけ | auth 2 |
| `AWS::Logs::MetricFilter` | `<LogGroupName>\|<FilterName>` | FilterName だけ | auth 1 / api 1 |
| `AWS::AppSync::GraphQLApi` | `<ApiId>` | ARN | api 1 |

回避は `--resource <論理ID>=<値>` で明示すること。`--resource` を1つでも渡すと指定したものしか取り込まなくなるので、残りを自動解決させる `--auto` も付ける。`migrate-to-cdkd.sh` の `identifier_overrides` が CloudFormation から引いて組み立てる。

**UserPoolClient は「0.291.23 で修正済み」ではなかった。** 先行リポジトリが 0.291.16 で踏んだ件を [go-to-k/cdkd#3701](https://github.com/go-to-k/cdkd/issues/3701) が直したと読んで回避を落としたが、0.291.31 で現に落ちた。手順5 の `cdkd diff --all` には出ず、取り込みで初めて出る。診断を diff だけで済ませたのが誤りだった。

**`cdkd export` のインラインポリシー削除が空振りする（未修正。回避が要る）。** `AWS::IAM::Policy` を消すときに `PolicyName` ではなく物理 ID を使うため実体が残り、戻しのフェーズ2 が必ず落ちる。2026-10-03 の手順6 で実地に踏んだ。詳細と回避は下の「`cdkd export` はインラインポリシーの手当てが要る」、上流への報告の下書きは [#228](https://github.com/yuuuuuuu168/sakekasu-builder/issues/228)。取り込み（手順7）には影響しない。

## 先に片付けること

[#129](https://github.com/yuuuuuuu168/sakekasu-builder/issues/129)（`logRetention` → `logGroup`）は**完了済み**。2026-08-18 に dev の3スタックへ反映し、`Custom::LogRetention` は6個とも消えた（経緯は [log-group-import.md](log-group-import.md)）。

これで CloudFormation へ戻すときの障害がひとつ減った。CFn は Lambda 実装のカスタムリソースを IMPORT できないため、`Custom::LogRetention` が残っていると `cdkd export --include-non-importable` による2フェーズ移行（フェーズ2で CFn が再 CREATE し、`onCreate` が呼び直される）が要る。いまはその必要が無い。

## 移行対象

`deploy.yml` が `cdk deploy --all` で流しているスタック。`-c env=dev` は `cdk.json` の context 既定値。

- `sakekasu-dev-auth`。移行は済ませたが、その後 共通ログインへ移ったのでアプリから外した（[shared-login.md](shared-login.md) の「旧ユーザープールを外す」）
- `sakekasu-dev-api`
- `sakekasu-dev-monitoring`
- `sakekasu-dev-health-global`（us-east-1）。移行は済ませたが、その後 AWS Health の通知を共通基盤へ移したのでアプリから外した（下の「health-global を外した」）

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

**`sakekasu-cdkd-deploy` に入れるのは `sakekasu-github-actions-deploy` だけ。** 人間が `AdministratorAccess` で入ろうとしても `sts:AssumeRole` が拒否される。CI 用に絞ったロールなので、手元から cdkd を打つときは `CDKD_ROLE_ARN` を渡さず、自分の権限で直接実行する（手順6・手順7 を参照）。state バケット `cdkd-state-<アプリのアカウント ID>` のバケットポリシーはアカウント外からのアクセスを拒否するだけなので、同一アカウントの管理者なら読み書きできる。

### 3.5. アプリの全ロールに境界を付ける

```bash
AWS_PROFILE=sakekasu-builder npx cdk diff --all -c env=dev
AWS_PROFILE=sakekasu-builder npx cdk deploy --all -c env=dev
```

13個のロールに `PermissionsBoundary` が付くだけの差分になる。ロールの作り直しは発生しない。

PR をマージすると `deploy.yml` が同じことをするので、手順3を先に済ませてあれば、この手順はマージで自動的に済む。実際そうなった（「現在どこまで進んでいるか」を参照）。

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

2026-10-03 に cdkd 0.291.31 で実行し、4スタックすべてが処理され、未対応の型もプロパティも出なかった。件数は合成結果と一致している。

| スタック | `cdkd diff` | 合成結果（`AWS::CDK::Metadata` を除く） |
| --- | --- | --- |
| auth | 9 | 9 |
| api | 54 | 54 |
| monitoring | 48 | 48 |
| health-global | 3 | 3 |

Cloud Control にフォールバックする3種類（UserPoolClient 2、FunctionConfiguration 4、MetricFilter 2）も一覧に出たうえで何も言われていない。

**ただし `cdkd diff` が通ることは取り込めることを意味しない。** 手順7 の前検査で、UserPoolClient 2件・MetricFilter 2件・GraphQLApi 1件が識別子の食い違いで取り込めなかった。diff は合成結果と state／AWS を比べるだけで、Cloud Control の識別子を解決しない。この型の問題は `cdkd import` を打って初めて出る。

8/16 に 0.283.25 で取った値（auth 12 / api 49 / monitoring 46 / health-global 3）とは件数が違うが、原因は cdkd ではなく CDK 側のコードの変化。auth が 12 → 9 と減ったのは [#129](https://github.com/yuuuuuuu168/sakekasu-builder/issues/129) の `logRetention` → `logGroup`（8/18 反映）で `Custom::LogRetention` と provider 一式が消え、明示の LogGroup が1つ増えた差。api と monitoring は同じ分を引いたうえで機能追加で増えている。

### 6. CloudFormation へ戻せることを先に確認する

戻せない状態で本移行に入らない。いちばん小さい `sakekasu-dev-health-global`（4リソース、カスタムリソースなし）で往復を確認する。

**このスタックは us-east-1 にあるので `AWS_REGION` を合わせて打つ。** 合わせないと `cdkd import` が ap-northeast-1 で CloudFormation を探し、全リソースが「not found」になる（上の「cdkd の版と、先行リポジトリで判明している不具合」を参照）。ここが移行の最初の一手なので、知らないと不具合を仕様と取り違えやすい。

**`CDKD_ROLE_ARN` は渡さない。** 手元から打つときは自分の権限で直接実行する（手順3 の末尾を参照）。渡すと `sts:AssumeRole` で拒否される。

**前検査の `--dry-run` に `--migrate-from-cloudformation` を付けない。** 0.291.31 は両方を渡すと次のエラーで止まる。

```
Error: --migrate-from-cloudformation is not compatible with --dry-run: the post-state-write
retirement (UpdateStack + DeleteStack) issues real AWS calls.
```

退役処理（UpdateStack と DeleteStack）は実際に AWS を叩くので dry-run に含められない、という趣旨。取り込み自体の下見は `--dry-run` 単独で取る。

**`export` の前に、インラインポリシーを実際の名前で手動削除する。** これを省くと必ずフェーズ2 で落ちる。cdkd 側の不具合の回避で、理由は下の「`cdkd export` はインラインポリシーの手当てが要る」にある。

```bash
cd infra
export AWS_PROFILE=sakekasu-builder

# 取り込みの下見。全リソースが imported で、not found / unsupported が 0 であること
AWS_REGION=us-east-1 npx cdkd import sakekasu-dev-health-global --dry-run

# 取り込む
AWS_REGION=us-east-1 npx cdkd import sakekasu-dev-health-global \
  --migrate-from-cloudformation --yes

# 戻す計画だけ先に見る（まだ何も変えない）
AWS_REGION=us-east-1 npx cdkd export sakekasu-dev-health-global --dry-run

# 回避策。ここから次のコマンドが終わるまでロールの権限が落ちる
aws iam delete-role-policy \
  --role-name dev-sakekasu-health-forwarder \
  --policy-name HealthForwarderRoleDefaultPolicy087A304B

# CloudFormation へ戻す
AWS_REGION=us-east-1 npx cdkd export sakekasu-dev-health-global
```

`--dry-run` を削除の前に置くのは、権限の空く窓を短くするため。

`migrate-to-cdkd.sh` も同じ分け方をしている（前検査は `--dry-run` 単独、本番は `--migrate-from-cloudformation --yes`）。

`export` は CFn の IMPORT チェンジセットを使うので、AWS のリソースは作り直されない。成功すると cdkd 側の state は消える（`state orphan` は要らない）。

`health-global` を選ぶのは、小さいことに加えて Export も ImportValue も持たないため。取り込んでも他のスタックの参照を壊さず、単独で往復できる。

#### 2026-10-03 の結果

往復は通った。ただし素では通らず、上の回避策が要った。

1回目（回避策なし）はフェーズ2 の UPDATE が `UPDATE_ROLLBACK_COMPLETE` で落ちた。リソースは失われず、復旧は下の「戻しがフェーズ2 で落ちたとき」の3手で済んだ。2回目（回避策あり）は `✓ Phase 2: 1 IMPORT-unsupported resource(s) re-CREATEd.` まで通り、CFn スタックは4リソースで `UPDATE_COMPLETE`、cdkd state も自動で消えた。

これで手順6 のゲートは通過と見なす。戻す道は塞がっていないが、素通りではなく手当てが要る。

0.291.23 で直ったはずの Cognito UserPoolClient の物理 ID は、`health-global` に UserPoolClient が無いためここでは確かめられていない。実物での確認は手順7 で auth を取り込むときになる。

#### `cdkd export` はインラインポリシーの手当てが要る

`AWS::IAM::Policy` は CFn の IMPORT に対応していないため、`cdkd export` は「フェーズ1 で他を IMPORT → AWS 側の実体を消す → フェーズ2 の UPDATE で CFn に作り直させる」という段取りを取る。この真ん中の削除が空振りする。

cdkd は削除する名前を**リソースの物理 ID から**作っていて、`PolicyName` プロパティを見ていない。インラインポリシーを IAM が識別するのは `PolicyName` のほうなので、この2つは一致しない。

| | 値（`health-global` の例） |
| --- | --- |
| IAM 上の名前（`PolicyName`） | `HealthForwarderRoleDefaultPolicy087A304B` |
| CloudFormation の物理 ID | `sakek-Healt-8lWbKTx3dWdM` |

存在しない名前に対する削除なので IAM は `NoSuchEntityException` を返すが、cdkd がこれを「もう無いので成功」として握りつぶし、`✓ deleted <物理ID>` と出す。実体は残ったままフェーズ2 に入り、CFn の CREATE が名前の衝突で落ちる。

```
CREATE_FAILED: The policy HealthForwarderRoleDefaultPolicy087A304B already exists on the role dev-sakekasu-health-forwarder.
```

回避は、`export` の前にインラインポリシーを実際の名前で消しておくこと。cdkd の空振り削除が無害になり、フェーズ2 の CREATE が通る。

**取り込み（手順7）には影響しない。** この不具合は戻す経路にしか無い。ただし4スタックには `AWS::IAM::Policy` が13個ある（api 8 / monitoring 3 / auth 1 / health-global 1）。CDK がロールに権限を与えると自動で付く `DefaultPolicy` がこれなので、戻す必要が出たら全部に同じ手当てが要る。

詳細と上流への報告の下書きは [#228](https://github.com/yuuuuuuu168/sakekasu-builder/issues/228) にある。

#### 戻しがフェーズ2 で落ちたとき

`cdkd export` が `Phase 1 (IMPORT) succeeded; phase 2 (UPDATE) failed` で落ちたときの状態はこうなる。

- AWS の実物は無事。インラインポリシーも残っている（空振り削除なので消えていない）
- CFn スタックは `UPDATE_ROLLBACK_COMPLETE`。IMPORT 済みのリソースは入っているが、ポリシーが欠けている
- cdkd state は手つかずで3リソースとも残る。CFn と cdkd の両方が同じリソースを持つ状態

この状態で `cdkd deploy` を打たない（cdkd 自身も警告を出す）。また、直すまで `infra/**` を main に入れない。`deploy` の `cdk deploy --all` が同じ衝突で落ちる。

復旧は CloudFormation 管理に戻す方向で3手。

```bash
cd infra
export AWS_PROFILE=sakekasu-builder

# 1. インラインポリシーを名前で消す。ここから 2 が終わるまで権限が落ちる
aws iam delete-role-policy \
  --role-name dev-sakekasu-health-forwarder \
  --policy-name HealthForwarderRoleDefaultPolicy087A304B

# 2. CFn に作り直させる
npx cdk diff sakekasu-dev-health-global -c env=dev
npx cdk deploy sakekasu-dev-health-global -c env=dev

# 3. cdkd の古い state を片付ける
AWS_REGION=us-east-1 npx cdkd state orphan sakekasu-dev-health-global
```

cdkd のエラーメッセージは `aws cloudformation create-change-set` を手で組む手順を案内するが、`cdk deploy` が同じテンプレートで同じことをするので、普段の道具で済ませてよい。

手順2 の `cdk diff` では、cdkd が IMPORT 用に注入した `DeletionPolicy: Delete` の削除も差分に出る。これは戻って正しい。

### 7. 既存スタックの取り込み

`infra/scripts/migrate-to-cdkd.sh` を打つ。手作業で `cdkd import` を並べない。

```bash
cd infra
AWS_PROFILE=sakekasu-builder bash scripts/migrate-to-cdkd.sh
```

手元から打つときは `CDKD_ROLE_ARN` を渡さない（手順3 の末尾を参照）。ワークフローに組み込む手順9 では渡す。

スクリプトは全スタックを `--dry-run` で調べ、全リソースが取り込めると分かったときだけ移す。1つでも引っかかれば、どのスタックにも手を付けずに `engine=cfn` を返して抜ける。移し終えた後に打っても何もしない。

`--record-resource-mapping` が書き出す論理 ID と物理 ID の対応表は `mapping-<スタック名>.json` に残る。後から「何を取り込んだか」を追うときに要る。

**識別子の食い違う型は `--resource` で明示する。** スクリプトの `identifier_overrides` が CloudFormation から引いて組み立てる。詳しくは上の「cdkd の版と、先行リポジトリで判明している不具合」。手当てが要るのは UserPoolClient / MetricFilter / GraphQLApi の3型で、`infra/__tests__/migrate-to-cdkd.test.ts` が対象が落ちていないかと件数が変わっていないかを見ている。

### 2026-10-03 の前検査の結果

1回目は引っかかり、**どのスタックにも手を付けずに `engine=cfn` で抜けた**。設計どおりの止まり方で、AWS の状態は手順7 の前と同じ。

```
Summary: 52 imported, 1 not found, 0 unsupported, 0 out of scope, 1 failed   ← api
Summary:  6 imported, 0 not found, 0 unsupported, 0 out of scope, 3 failed   ← auth
::warning::cdkd への移行を見送ります。スタックには手を付けていません
```

落ちた5件はすべて識別子の食い違い。`identifier_overrides` を足して解決できるようにした。

2回目は `mapfile` で引っかかった。**macOS の bash は 3.2 で `mapfile` が無い。** 配列が空のまま `--resource` が1つも渡されず、1回目と同じ結果になった。しかも `mapfile: command not found` が流れるだけで処理は続く。読み込みを `while read` に書き換え、組み立てた数が合わなければ落とすようにした。bash 3.2 で動かない書き方（`mapfile` / `readarray` / 連想配列 / `${x^^}` / `&>`）は検査で弾いている。

### 2026-10-03 の取り込みの結果

3回目で全スタックが通った。

```
Summary:  3 imported, 0 not found, 0 unsupported, 0 out of scope, 0 failed   ← health-global
Summary: 48 imported, 0 not found, 0 unsupported, 0 out of scope, 0 failed   ← monitoring
Summary: 54 imported, 0 not found, 0 unsupported, 0 out of scope, 0 failed   ← api
Summary:  9 imported, 0 not found, 0 unsupported, 0 out of scope, 0 failed   ← auth
engine=cdkd
```

4スタックとも `CloudFormation stack '...' retired.` まで進み、CloudFormation 側のスタックは残っていない。`identifier_overrides` の手当ては api で2件・auth で3件が `already overridden by --resource` として効いた（`UserPoolUserPoolClient40176907 (ap-northeast-1_eZOfInCT4|3a4unc2dbutrkm2hjn887s1h9m)`、`SakekasuApiED3BBF54 (6mtw5cju3naydf7mxnaoulowta)` など）。

出力に混じった2種類のメッセージは、どちらも想定どおり。

**`weak reference — producer is not cdkd-managed`。** `Fn::ImportValue` の解決元がまだ CloudFormation 側にいる、移行の途中だけ出る注意。取り込みが進むにつれ消える。

**`Failed to read state for stack ...: Unsupported state schema version 10`。** 手元の `node_modules` が lockfile より古かっただけ。`infra/` で `npm ci` を打てば消える。下の「state バケットのスキーマ版」を参照。

**移す順は monitoring → api → auth。** CloudFormation は、他のスタックが `Fn::ImportValue` で読んでいる Export を持つスタックを消せない。合成結果で確かめた向きは次のとおり。

| スタック | Export | ImportValue |
| --- | --- | --- |
| `auth` | 2 | 0 |
| `api` | 7 | 1（auth から） |
| `monitoring` | 0 | 9（api から7、auth から2） |
| `health-global` | 0 | 0 |

auth を先に消そうとすると `Export ... cannot be deleted as it is in use by ...` で DeleteStack が落ちる。しかも落ちる位置が「state は書けたが CloudFormation のスタックは残っている」という中途半端なところで、復旧が手作業になる。`health-global` は誰とも Export をやり取りしないので順番に関係なく、いちばん小さいぶん先頭に置いてある。

この順番はスクリプトに直書きなので、CDK 側でスタック間の参照を足したり向きを変えたりすると黙って壊れる。`infra/__tests__/migrate-to-cdkd.test.ts` が合成結果と突き合わせて検査している。

リソースは再作成されない。`--migrate-from-cloudformation` は、CFn の全リソースに `DeletionPolicy: Retain` と `UpdateReplacePolicy: Retain` を注入する UpdateStack を打ってから DeleteStack する。スタックの記録だけが消えて、実体は残る。

移行途中は cdkd 管理と CFn 管理が混在するが、`Fn::ImportValue` は cdkd の state に無ければ CloudFormation の Exports にフォールバックするため、参照は解決される。

### 移行が途中で止まったとき

スクリプトが「cdkd の状態と CloudFormation のスタックの両方を持っています」で落ちたら、`cdkd import --migrate-from-cloudformation` が state を書いた後、CloudFormation のスタックを消すところで止まっている。リソースは cdkd の state に載っているので、残っているのは CloudFormation のスタックの記録だけ。

まず落ちた理由を確かめる。Export が使用中なら、そのスタックを読んでいる側がまだ CloudFormation に残っている。読む側を先に移してから、もう一度スクリプトを打つ。

それでも進まないときは、対象のスタックだけを手で流す。

```bash
cd infra
AWS_REGION=<スタックのリージョン> AWS_PROFILE=sakekasu-builder \
  npx cdkd import <スタック名> --migrate-from-cloudformation --force --yes -c env=dev
```

`AWS_REGION` をスタックのリージョンに合わせるのを忘れない（理由はスクリプトのコメント）。

### 8. drift の確認

取り込みの直後に4スタックとも流す。

```bash
cd infra
export AWS_PROFILE=sakekasu-builder
npx cdkd drift sakekasu-dev-auth
npx cdkd drift sakekasu-dev-api
npx cdkd drift sakekasu-dev-monitoring
AWS_REGION=us-east-1 npx cdkd drift sakekasu-dev-health-global
```

`health-global` は us-east-1。手順7 と同じく、cdkd はスタックのリージョンを見ずに実行時の `AWS_REGION` でクライアントを作るので、ここでも合わせる。

差分がなければ終了コード 0。出た場合は `cdkd drift <stack> --json` で中身を見る。state を実物に合わせるなら `--accept`、実物を state に合わせるなら `--revert`。

**ここがクリーンになったら、手順9 の PR をすぐマージする。** 取り込みが終わった時点で CloudFormation のスタックは消えているので、main の `deploy.yml`（`cdk deploy --all`）が走ると全部を新規作成しにいく。drift の確認は窓を開けたままやっていることになる。

### 2026-10-03 の drift の結果

| スタック | drift | 判定不能（provider 未対応） |
| --- | --- | --- |
| `auth` | 1 | 1 |
| `api` | 4 | 31 |
| `monitoring` | 29 | 3 |
| `health-global` | 0 | 1 |

**出た差分は1つ残らず「日本語が `?` に置き換わっている」だけ。** 構造の違いは無い。

```
~ AlertTopic2720D535 (AWS::SNS::Topic)
  - DisplayName: 酒カス 監視アラート     ← cdkd の state（テンプレートの値）
  + DisplayName: ??? ??????              ← AWS の実物
```

`-` が state、`+` が AWS の実物。**実物のほうが壊れている。** 表示の問題ではない。

- 手元の `cdkd drift` は同じ画面で state 側の日本語を正しく出しながら実物側だけ `?` にしている
- クラウドから `aws cloudwatch describe-alarms` / `cognito-idp describe-user-pool` / `sns get-topic-attributes` を引いても `?` が返る。`PYTHONUTF8=1` を付けても、UTF-8 が通るパイプに流しても変わらない（1文字が1バイトの `0x3f`）

書いたのは CloudFormation。これらのリソースは全部 `cdk deploy` が最後に書いており、cdkd の state はテンプレートの値（正しい日本語）を持っている。`cdk diff` はテンプレート同士を比べるだけで実物を見ないので、これまで誰も気づかなかった。cdkd が実物と比べる仕組みを持っていて初めて見えた。

**`--accept` を打たない。** 打つと壊れたほうを state に焼き付けてしまう。直すなら `cdkd drift <スタック> --revert`（AWS ← state）。

**`cdkd deploy` では直らない。** 2026-10-03 の初回デプロイで実地に確かめた。deploy が比べるのは合成テンプレートと state であって、AWS の実物ではない。文字化けは state と実物のあいだにしか無いので、deploy からは見えない。

| アラーム | テンプレートと state の差 | デプロイ後 |
| --- | --- | --- |
| `dev-sakekasu-ocr-slo-availability` | あり（#231 で説明文を変えた） | 05:14:53 に更新。日本語が正しく入った |
| `dev-sakekasu-ocr-errors` | なし | 04:06:53 のまま。`?` が残る |

前者が通ったことで、**cdkd 自身は日本語を正しく書ける**ことも裏が取れた。壊したのは CloudFormation の側。

いま利用者に届いている確認メールは次のようになっている。

```
件名: sakekasu-builder ?????
本文: ?????????? {####} ???
```

残りの差分2件は `OcrAvailabilitySlo` / `OcrLatencySlo` の `LastUpdatedTime`（2026-08-17 → 2026-10-03T04:06:34Z）。AWS が勝手に付ける読み取り専用の項目で、cdkd がこれを比較対象に入れているぶん、今後も毎回 drift として出続ける。

「判定不能」は全部 `AWS::IAM::Policy`。Cloud Control の provider が drift 検出に対応していない。

### 取りこぼした4リソース（手順9 のマージ前に取り込む）

**窓を開けている間に `infra/**` の PR が main に入った。** [#231](https://github.com/yuuuuuuu168/sakekasu-builder/pull/231)（presigned-url の SLO）が 03:03 にマージされ、`deploy` が 03:03〜03:07 に走っている。このときはまだ CloudFormation のスタックが生きていたので成功し、monitoring に4リソースが増えた。

取り込み（手順7）はそのあと、**#231 を含まないブランチで合成した `cdk.out`** を使って走った。cdkd import は合成結果に載っている論理 ID しか取り込まないので、CloudFormation 側の52個のうち48個だけが state に入り、残り4つは Retain で実物だけが残った。

| 論理 ID | 型 | 物理名 |
| --- | --- | --- |
| `PresignedUrlAvailabilitySlo` | `AWS::ApplicationSignals::ServiceLevelObjective` | `dev-sakekasu-presigned-url-availability` |
| `PresignedUrlLatencySlo` | `AWS::ApplicationSignals::ServiceLevelObjective` | `dev-sakekasu-presigned-url-latency` |
| `PresignedUrlAvailabilitySloBreachF3AD5564` | `AWS::CloudWatch::Alarm` | `dev-sakekasu-presigned-url-slo-availability` |
| `PresignedUrlLatencySloBreachC7C7585E` | `AWS::CloudWatch::Alarm` | `dev-sakekasu-presigned-url-slo-latency` |

PR #230 の `cdkd diff` はこの4つを `[+]`（新規作成）と出している。このままマージすると `cdkd deploy` が既存の SLO を作りにいって衝突する。`cdkd drift` では見つからない（state に無いものは見に行かないため）。

マージの前に state へ入れる。CloudFormation のスタックはもう無いので `--migrate-from-cloudformation` は付けない。既存を触らない追加なので `--force` も要らない。

```bash
cd infra
git pull
export AWS_PROFILE=sakekasu-builder
npx cdkd import sakekasu-dev-monitoring -c env=dev --dry-run \
  --resource PresignedUrlAvailabilitySlo=dev-sakekasu-presigned-url-availability \
  --resource PresignedUrlLatencySlo=dev-sakekasu-presigned-url-latency \
  --resource PresignedUrlAvailabilitySloBreachF3AD5564=dev-sakekasu-presigned-url-slo-availability \
  --resource PresignedUrlLatencySloBreachC7C7585E=dev-sakekasu-presigned-url-slo-latency
```

`4 imported, 0 not found, 0 failed` を確かめてから `--dry-run` を外して打つ。`--auto` は付けない。付けると残り48個も解決し直そうとするが、CloudFormation のスタックが無いので物理 ID を引けない型（UserPoolClient / GraphQLApi など）で落ちる。

**教訓として、窓の約束は約束のままだった。** ブランチ保護にも CI にも、取り込み中に `infra/**` を main に入れさせない仕掛けは無い。次に同じことをするなら、取り込みの直前に `infra/**` を触る PR を止める手立てを先に用意する。

### 最初の `cdkd deploy` で何が起きるか

取り込み後の `cdkd diff` は `0 to create, 17 to update, 0 to delete`（monitoring）。削除も差し替えも無い。

| 内訳 | 中身 |
| --- | --- |
| LogGroup 3件の `DeletionPolicy` / `UpdateReplacePolicy` | metadata only, no AWS API call |
| Lambda 3件の `Code.S3Bucket` | `cdk-hnb659fds-assets-*` → `cdkd-assets-*` |
| アラーム8件の `Dimensions`、HealthCheck と Canary の環境変数、Canary のポリシー | 直値 → `Fn::ImportValue`。解決後の値は同じ |
| `OcrAvailabilitySloBreach` / `OcrLatencySloBreach` の説明文 | #231 の実変更 |

**デプロイ後に `Fn::ImportValue` の解決を確かめる。** CloudFormation のスタックはもう無いので、cdkd は自分の state から解決する。失敗すると `Dimensions` に `{"Fn::ImportValue": ...}` がそのまま入り、**何も監視していないアラームが静かにできあがる**。アラームは壊れても鳴らないだけで、壊れたことに気づく手立てが無い。

```bash
aws cloudwatch describe-alarms --region ap-northeast-1 \
  --alarm-names dev-sakekasu-ocr-errors dev-sakekasu-appsync-5xx \
  --query 'MetricAlarms[].[AlarmName,Dimensions]' --output json
```

`dev-sakekasu-ocr-analyzer` や `6mtw5cju3naydf7mxnaoulowta` のような実際の値が入っていればよい。`Fn::ImportValue` の文字列が見えたら解決に失敗している。

同じ経路で入れ替わるものが他に3つある。あわせて見る。

- `HealthCheckFunction` の `HEALTH_CHECK_TARGETS`（appsync の URL）
- `SommelierCanaryFunction` の `USER_POOL_ID` / `USER_POOL_CLIENT_ID`
- `SommelierCanaryFunctionServiceRoleDefaultPolicy` の `cognito-idp:AdminInitiateAuth` のリソース

前者2つは外形監視とカナリアが失敗すれば `WatcherFailure*` アラームで気づけるが、アラーム自身の `Dimensions` には見張り役がいない。

### 2026-10-03 の初回デプロイの結果

成功した。確かめた3点のうち2つは想定どおり、1つは余の読み違いだった。

**`Fn::ImportValue` は正しく解決された。** アラームの `Dimensions` には実際の値が入っている（`dev-sakekasu-ocr-analyzer` / `6mtw5cju3naydf7mxnaoulowta` / `dev-sakekasu-presigned-url`）。`Fn::ImportValue` の文字列は残っていない。解決後の値が state の直値と同じだったため、cdkd は API を呼ばずに済ませている（`dev-sakekasu-ocr-errors` の `AlarmConfigurationUpdatedTimestamp` が 04:06:53 のまま）。「17 to update」の大半はこれで、実際の書き込みが起きたのは #231 の説明文変更とアセットの張り替えだけだった。

**実変更は適用された。** `dev-sakekasu-ocr-slo-availability` の説明文と Lambda 3本のコードの取得元が 05:14:53 に更新されている。

**文字化けは直らなかった。** 上の「2026-10-03 の drift の結果」を参照。`cdkd drift --revert` が要る。

Lambda の環境変数（`HEALTH_CHECK_TARGETS` / `USER_POOL_ID` / `USER_POOL_CLIENT_ID`）は読み取り専用プロファイルからは確かめられない。`kms:Decrypt` が Permission Set で明示的に拒否されているため、`get-function-configuration` が `Environment.Error` を返す（設計どおり）。外形監視とカナリアが動き続けているかを、メトリクスの発行とアラームの状態で代わりに見る。

外形監視はデプロイ後の 05:16 にメトリクスを発行しており、環境変数は壊れていない。カナリアは実行間隔が長く、デプロイ直後の時点では次の実行がまだ来ていなかった。止まれば `WatcherSilentsommeliercanary` が鳴る。デプロイ直後のアラームは27件すべて OK。

### 文字化けを直す（`cdkd drift --revert`）

`auth` から始めた。`--dry-run` は4つのパスだけを当てる計画に見えたが、本番は落ちた。**AWS は変更されていない**（`0 reverted, 1 failed`）。

```
✗ sakekasu-dev-auth/UserPool6BA7E5F2 (AWS::Cognito::UserPool): AWS update failed —
  2 validation errors detected:
  Value '' at 'smsAuthenticationMessage' failed to satisfy constraint:
    Member must satisfy regular expression pattern: (?s).*\{####\}(?s).*;
  Value '' at 'smsAuthenticationMessage' failed to satisfy constraint:
    Member must have length greater than or equal to 6
```

`SmsAuthenticationMessage` はテンプレートにも実物にも無い（`describe-user-pool` で `null`）。cdkd がそこに**空文字を入れて送っている**。

**cdkd 側の機構（0.291.31、`dist/program-*.js`）。** 読み取り側が、無い任意プロパティを `""` に正規化する。

```js
result["SmsAuthenticationMessage"] = pool.SmsAuthenticationMessage ?? "";
```

更新側は `!== void 0` で入れるかどうかを決めるので、この `""` が素通りして API に渡る。

```js
if (properties["SmsAuthenticationMessage"] !== void 0)
  updateParams.SmsAuthenticationMessage = properties["SmsAuthenticationMessage"];
```

オブジェクト型（`SmsConfiguration` / `UserPoolAddOns`）には `isEmptyObjectPlaceholder` で同じ穴を塞いである。文字列型には無い。作成側は真偽値で見ている（`if (properties[...])`）ので `""` は落ちる。**更新だけが通る。**

**文字化けより重い。** cdkd は provider.update に state の全体像を渡すので、この1件のために **UserPool へのあらゆる更新が落ちる**。auth に何か変更を入れたときも同じ所で止まる。

#### 回避

`mfaMessage` を明示して、送られる値を妥当にする。SMS の MFA を有効にするわけではない（`mfaSecondFactor.sms` は `false` のまま、`SmsConfiguration` も置かない）。

```ts
mfaMessage: '認証コードは {####} です。',
```

**これで文字化けも同時に直る。** provider.update は state の全体像を書くので、一度 update が呼ばれれば state が持つ正しい日本語もまとめて入る。`--revert` は要らない。

検査を2件足した（`infra/__tests__/auth-stack.test.ts`）。`SmsAuthenticationMessage` が Cognito の制約（6文字以上・`{####}` を含む）を満たすことと、SMS の MFA そのものは有効にしていないこと。`mfaMessage` を落とす変異と `sms: true` にする変異のどちらでも落ちる。`{####}` を抜く変異は CDK 自身が合成時に弾く。

上流への報告の下書きは [#235](https://github.com/yuuuuuuu168/sakekasu-builder/issues/235)。

### 文字化けの直し方はスタックごとに違った

3スタックとも「state は正しい日本語、実物は `?`」という同じ形なのに、通った手立てが違う。

| スタック | 件数 | 通った手立て |
| --- | --- | --- |
| `auth` | 1（UserPool の4パス） | `mfaMessage` を足して `cdkd deploy`。`--revert` は cdkd の不具合で落ちた（[#235](https://github.com/yuuuuuuu168/sakekasu-builder/issues/235)） |
| `api` | 4（AppSync の Code） | `cdkd drift --revert`。`4 reverted` でそのまま通った |
| `monitoring` | 31 | `scripts/fix-monitoring-mojibake.mjs`。drift の土台が実物に替わっていて `--revert` が動かない |

確認は実物を読んで行った。`auth` は Cognito の確認メールが `sakekasu-builder ?????` から `sakekasu-builder 確認コード` に戻り、`api` は AppSync のリゾルバのコメントが戻っている。

**`?` は表示の問題ではなく実データ。** 読み取り専用プロファイルの AWS CLI でも、`PYTHONUTF8=1` を付けて UTF-8 が通るパイプに流しても `?`（1文字が1バイトの `0x3f`）。同じ CLI が修復後は日本語を返すので、これで区別できる。

### `cdkd drift` が「差なし」と言う（最初のデプロイ後）

`monitoring` で、state と実物が違うのに「差なし」と出る。

| | 値 |
| --- | --- |
| cdkd の state | 日本語（`cdkd diff` が `No changes detected`） |
| AWS の実物 | `?`（`DescribeAlarms` と `cloudcontrol get-resource` の両方） |
| `cdkd drift` | `no drift detected (49 resources checked, 3 unsupported)` |

**版の退行ではない。** 最初はそう書いたが誤りだった。`dist` を読むと、drift の比較の土台は2通りある。

```js
const useObserved = resource.observedProperties !== void 0;
const baseline = useObserved ? resource.observedProperties : resource.properties ?? {};
```

- `properties` … テンプレートの意図。取り込みが書くのはこれだけ
- `observedProperties` … **デプロイ時に AWS から撮った実物のスナップショット**。`cdkd deploy` が記録する

`cdkd diff` が「差分なし」なので `properties` はテンプレートどおりの日本語。それでも drift が「差なし」と言うなら、使われた土台は `properties` ではない。つまり `observedProperties`（= 文字化けした実物）が土台になっている。

| 時点 | state の中身 | drift の土台 | 結果 |
| --- | --- | --- | --- |
| 取り込み直後 | `properties` だけ | テンプレートの意図（日本語） | 29件を検出 |
| 最初の `cdkd deploy` 後 | `observedProperties` が入る | デプロイ時の実物（`?`） | 差なし |

`auth` と `api` で検出できたのも版ではなく順番の問題。あれを見た時点では、そのスタックのリソースにまだ `observedProperties` が入っていなかった。

**最初のデプロイが、既存のずれを黙って「正常」として焼き付ける。** drift の設計としては筋が通っている（「デプロイしてから変わったか」を見る道具なので）。ただ移行の場面では罠になる。手順8 で29件を見つけ、手順9 をマージしてデプロイすると、その29件が直らないまま消える。

**`cdkd diff` と `cdkd drift` は別のものを見ている。** diff はテンプレートと state、drift は state（か実物のスナップショット）と実物。どちらも「差なし」でも実物がテンプレートと違うことがある。移行の直後は drift を先に見て、見つけた差分はデプロイより前に片付ける。

上流への報告の下書きは [#239](https://github.com/yuuuuuuu168/sakekasu-builder/issues/239)。

### monitoring の修復スクリプト

[`infra/scripts/fix-monitoring-mojibake.mjs`](../infra/scripts/fix-monitoring-mojibake.mjs)。

```bash
cd infra
npx cdk synth sakekasu-dev-monitoring -c env=dev
AWS_PROFILE=sakekasu-builder node scripts/fix-monitoring-mojibake.mjs --dry-run
AWS_PROFILE=sakekasu-builder node scripts/fix-monitoring-mojibake.mjs
```

- **直す値は合成結果から引く。** スクリプトに文面を写し取ると `lib/monitoring-stack.ts` と二重管理になる。検査が、拾った文面がスクリプトに直書きされていないことを見ている
- **パッチは1プロパティの `replace` だけ。** Cloud Control は実物を読んでからパッチを当てるので、触っていない項目・アラームの履歴・SNS の購読には影響しない
- **冪等。** すでに一致しているものは飛ばす
- 物理名が `Fn::` などで解決できないリソースは対象から外し、理由を出す。黙って飛ばすと「直したつもりで直っていない」になる
- 対象は非ASCII を含む説明文だけ（ASCII だけの文面は壊されようがない）。2026-10-03 時点で33件のうち31件が修復対象、2件は手順9 のデプロイで既に直っていた

cdkd 側が drift を検出できるようになれば `cdkd drift <スタック> --revert` で済むので、このファイルは消してよい。

#### 2026-10-03 の修復の結果

```
対象 33 件: 一致 2 / 直した 31 / 失敗 0
```

実物を読んで確かめた。

| 確認項目 | 結果 |
| --- | --- |
| アラームの説明文 | 日本語に復帰（`ラベル画像の OCR が失敗しています（銘柄名の自動入力が効きません）` など） |
| SNS の表示名 | `酒カス 監視アラート` |
| EventBridge ルールの説明 | `AWS Health の障害・予定された変更を Slack へ流す` |
| SLO の説明 | `ラベル OCR の成功率（30日で 90%）。…` |
| アラーム27件の状態 | 全て OK。ALARM / INSUFFICIENT_DATA はゼロ |
| 副作用 | 通知アクション・OK アクション・説明文の欠落ゼロ。`Dimensions` / `Threshold` / `Period` も元のまま |

Cloud Control の read-modify-write が効いて、説明文だけが差し替わり他は無傷だった。

**`?` は表示の問題ではなく実データだったことも、ここで裏が取れた。** 同じ読み取り専用プロファイルの同じ CLI が、修復後は日本語を返す。

### スクリプトが黙って終わった（`~` を含むパス）

`fix-monitoring-mojibake.mjs` を手元から打ったら、**何も出さず exit 0 で終わった**。

原因は「直に実行されたときだけ本体を走らせる」判定。`import.meta.url` を
`new URL("file://" + process.argv[1]).href` と比べていた。

`import.meta.url` は `~` を `%7E` に符号化するが、`new URL` はそのまま残す。

```
import.meta.url                 : .../com%7Eapple%7ECloudDocs/probe.mjs
new URL("file://" + argv[1])    : .../com~apple~CloudDocs/probe.mjs
pathToFileURL(argv[1])          : .../com%7Eapple%7ECloudDocs/probe.mjs
```

**iCloud Drive のパスには `com~apple~CloudDocs` が必ず入る。** 手元のチェックアウトが
そこにあるため、判定が常に偽になっていた。空白（`Mobile Documents`）はどちらも同じく
符号化するので無関係。

`pathToFileURL` に直した。これが正しい逆変換。

**`check-lockfile-registry.mjs` も同じ書き方だった。** CI でしか走らずランナーのパスに
`~` が無いため表に出ていなかったが、依存の取得元を確かめる関門が黙って素通りする形
なので、性質はこちらのほうが悪い。あわせて直した。

**失敗が見えないことが問題。** エラーも非ゼロ終了も無いので、打った側は通ったと思う。
文字化けが直らないまま「直した」ことになりかけた。

検査を5件足した（`infra/__tests__/script-entrypoint.test.ts`）。`scripts/*.mjs` の全部に
ついて、パスの符号化に依らない判定になっていることと、`com~apple~CloudDocs` を含む
パスに置いて実行したとき本体が走る（何かを出して非ゼロで終わる）ことを見ている。
どちらかのファイルを元の書き方に戻すと2件落ちる。

### 混在したまま CloudFormation へ戻さない

宿題の「取り込み中に `infra/**` を main に入れさせない仕掛け」を考えていて、もっと手前に穴があるのを見つけた。

`migrate-to-cdkd.sh` の `pending` は「CloudFormation のスタックが残っているもの」しか集めない。移行済みのスタック（cdkd の状態があり CloudFormation のスタックは無い）はそこに入らない。前検査が失敗したときにそのまま `engine=cfn` を返すと、deploy が `cdk deploy --all` を打って**移行済みのぶんまで対象にする**。CloudFormation から見ればスタックが存在しないので、ゼロから作りに行く。

スクリプト冒頭が警告しているのと同じ事故になる。同じ名前の DynamoDB テーブルや S3 バケットで落ちるか、Cognito の UserPool のように名前が重複できるものは2つ目を黙って作る（利用者のアカウントが空の新しいプールに切り替わる）。

`engine=cfn` を返す前に、移行済みのスタックが1つでもあれば止めるようにした。混在したまま進むくらいなら止まる。残りを人の手で移すか戻すかを決めるのは人間の仕事。

`aws` と `npx` を偽物に差し替えて3経路を実地に確かめた。

| state の状況 | CloudFormation の状況 | 前検査 | 結果 |
| --- | --- | --- | --- |
| 2本に state あり | 2本は退役、2本は残存 | 失敗 | **`exit 1`。`engine=` を書かない** |
| state 無し | 4本すべて残存 | 失敗 | `engine=cfn`（従来どおり。戻して安全） |
| 4本すべて state あり | 4本すべて退役 | 通さない | `engine=cdkd` |

**`infra/**` を main に入れさせない仕掛けより、こちらが先。** 窓を守りたかった理由は「その状態でデプロイが走ると壊れる」ことだった。デプロイの側で止まるなら、何が main に入ったかに依らず守られる。PR の側で止める仕掛けは、このリポジトリがブランチ保護を使えない（無料プラン）ので赤いチェックを出すところまでしかできず、目印の置き忘れでも効かなくなる。

検査を4件足した（`infra/__tests__/migrate-to-cdkd.test.ts`）。`engine=cfn` の前で state を調べていること、移行済みがあれば止めること、止めるときに `engine=` を書かないこと、`migrated` の展開が bash 3.2 の `set -u` で落ちない書き方であること。歯止めを外す変異・`exit 1` を外す変異・素の配列展開に変える変異のどれでも落ちる。

### 取り込み済みリソースへの初回更新は改名になる（2026-10-04）

全スタックに `Project` / `Env` タグを足す PR（[#245](https://github.com/yuuuuuuu168/sakekasu-builder/pull/245)）をマージしたところ、デプロイが `sakekasu-dev-auth` で落ちた。2つのことが重なっていた。

**1. 取り込み済みリソースを cdkd が改名し、置き換え扱いにする。**

```
Resource SignupNotifierFunctionServiceRole180FCFE5 was replaced:
  sakekasu-dev-auth-SignupNotifierFunctionServiceRole-uF3uXTOrV5Pb
  → sakekasu-dev-auth-SignupNotifierFunctionServiceRole180FCFE5
```

古い名前は CloudFormation が生成したもの、新しい名前は cdkd が生成したもの。物理名を CFn に任せていたリソースは、cdkd が初めて更新するときに自分の流儀で名前を付け直す。タグに限らずどのプロパティ変更でも起きる。IAM ロールは13個あるので、何かを触るたびにこれが待っている。

**2. ロググループへのタグ付けが通らない。** こちらが直接の失敗原因。

```
Failed to update log group SignupNotifierLogGroupF4C03A83: Invalid resourceArn
```

さらに、デプロイロールに `iam:ListInstanceProfilesForRole` が無いため古いロールを削除できず、ロールバックで新しいロールを消すこともできなかった。結果として両方のロールが残り、Lambda は古い方を指したまま動き続けた。

#### どう収めたか

[#247](https://github.com/yuuuuuuu168/sakekasu-builder/pull/247) でタグを revert した。revert 前に `cdkd diff` を取ると `0 to create, 3 to update, 0 to delete` で、置き換えも削除も起きないことが先に分かった。cdkd の state はすでに新しいロールを自分のものとして持っていて、取り残された Lambda と権限ポリシーの参照先をそちらに揃えるだけだった。

**`iam:ListInstanceProfilesForRole` は足さなかった。** あれはロールの削除に要る権限で、足せば置き換えのたびに13個のロールが削除されうる状態になる。無かったことが結果的に安全装置として働いた。

古いロール `sakekasu-dev-auth-SignupNotifierFunctionServiceRole-uF3uXTOrV5Pb` は管理対象から外れて孤児として残っている。誰も使っていないので害は無い。削除は手作業。

#### 教訓

取り込み済みのスタックに対しては、**全リソースに一律で何かを足す変更を避ける**。1リソースずつ、計画を `cdkd diff` で見てから進める。DevOps Agent のリソース検出に要るタグは、CDK を通さず Resource Groups Tagging API で直接付けた（[docs/devops-agent.md](devops-agent.md) の「タグの付け方」）。合成テンプレートに `Tags` が無ければ cdkd は素通りするので、外から付けた値は消えない。

### 途中で落ちたデプロイは state と実物をずらして残る（2026-10-04）

DevOps Agent の webhook 転送 Lambda が、ログを1行も書けない状態でしばらく動いていた。

```
/aws/lambda/dev-sakekasu-devops-agent-webhook
  storedBytes: 0
  logStreams: []
```

実行ロールに CloudWatch Logs の権限が無かった。

```
sakekasu-dev-devops-agent-WebhookForwarderFunctionServi-002870db
  AttachedPolicies: []                          ← AWSLambdaBasicExecutionRole が無い
  インラインポリシー: secretsmanager:GetSecretValue のみ
```

合成テンプレートは `ManagedPolicyArns` に `AWSLambdaBasicExecutionRole` を置いている。
実物だけが欠けていた。

#### なぜ気づけなかったか

ロールの作成日時は 10/4 02:35:21 で、[#248](https://github.com/yuuuuuuu168/sakekasu-builder/pull/248) のデプロイが
`iam:CreateRole` で落ちた時刻と一致する。ロールは作られ、マネージドポリシーを付ける手前で
デプロイが止まった。**cdkd の state には「作成済み」とだけ記録された。**

翌日 [#249](https://github.com/yuuuuuuu168/sakekasu-builder/pull/249) のデプロイでは、このロールは `Unchanged: 1` として素通りしている。
state と合成テンプレートが一致していれば、cdkd は実物を見に行かない。
`cdkd diff` も差分を出さない。

CloudFormation ならロールバックで巻き戻るところだが、cdkd にそれは無い。
途中で落ちたデプロイは、作りかけのリソースと「作成済み」の state を残して終わる。

#### どう直したか

実物をテンプレートに合わせる側に倒した。cdkd を通さず直接付けている。

```sh
aws iam attach-role-policy \
  --profile sakekasu-builder \
  --role-name sakekasu-dev-devops-agent-WebhookForwarderFunctionServi-002870db \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

cdkd 経由で直そうとすると、取り込み済みリソースの改名・置き換えを踏む（ひとつ上の節）。
テンプレートが期待する状態に実物を寄せれば、state もテンプレートも触らずに済む。

#### 次に同じことが起きたら

**デプロイが途中で落ちたら、その回で作られたリソースを実物で確認する。** `cdkd diff` は当てにならない。
state が「作成済み」と言っている以上、差分は出ない。

見つけ方の例。

| 症状 | 疑うところ |
| --- | --- |
| ロググループの `storedBytes` が 0 のまま | 実行ロールに `AWSLambdaBasicExecutionRole` が付いているか |
| Lambda は動くのに特定の API だけ失敗する | インラインポリシーが途中までしか入っていないか |

同じスタックの他のリソースと比べるのが早い。今回は `dev-sakekasu-slack-notifier` の
ロールにマネージドポリシーが付いていたので、欠けているほうが異常だと分かった。

### 残っている宿題

| やること | なぜ |
| --- | --- |
| drift の土台が入れ替わる件を上流に報告する | 最初のデプロイが既存のずれを `observedProperties` に焼き付け、drift から見えなくなる |
| `infra/**` を main に入れさせない仕掛け | 上の歯止めでデプロイ側は守られた。PR 側で止めるかは未決 |

### state バケットのスキーマ版

`cdkd diff` を打つたびに、先行リポジトリの state を読めないという行が大量に流れる。

```
Failed to read state for stack sakekasu-kakeibo-dev-api: Unsupported state schema version 10 ...
  This cdkd binary supports versions 1, 2, 3, 4, 5, 6, 7, 8.
```

**原因は手元の `node_modules` が lockfile より古いこと。** cdkd を上げる必要は無い。0.291.31 の `dist` を直接読むと、スキーマ10 まで読める。

```
SCHEMA_VERSIONS_READABLE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
```

手元のエラーは `supports versions 1, 2, 3, 4, 5, 6, 7, 8` と言うので、0.291.31 より古いものが入っている。CI は毎回 `npm ci` で入れ直すため最初から出ていない。

```bash
cd infra
npm ci
npx cdkd --version   # 0.291.31
```

**自分の state も読めなくなる。** 手順9 のデプロイ（CI、0.291.31）が4スタックの state をスキーマ10 に上げたため、古い手元からは `cdkd drift` も `StateError` で止まる。2026-10-03 に実際に当たった。

### `cdkd scrub` はデプロイの後ろに置く

初回のデプロイがここで止まった。

```
Scrub of sakekasu-dev-api failed: could not resolve the Fn::ImportValue in resource
  SakekasuApiED3BBF54 at UserPoolConfig.UserPoolId: export
  'sakekasu-dev-auth:ExportsOutputRefUserPool6BA7E5F296FD7236' not found in any stack.
  Searched 17 cdkd state record(s) and CloudFormation exports.
```

scrub は state の中身を見る前に `Fn::ImportValue` を解決する。解決できないと
「解決できないので清いとは言えない」と言って拒否する（`ScrubRefusalError`）。値が
シークレットだった場合に「探す平文が無い」状態で清いと報告してしまうためで、
判断としては正しい。

**cdkd へ移した直後の state はリソースだけで、スタックの Output を持っていない。**
取り込みはリソースを記録するだけで、Output と Export を state に書くのは最初の
`cdkd deploy`。CloudFormation のスタックはもう無いので、そちらの Exports にも
フォールバックできない。つまり scrub をデプロイの前に置くと、移行の直後は必ず
そこで止まる。

デプロイの後ろに移した。**見張りとしては弱くならない。** 平文を state に書くのは
deploy そのもので、前に見ているのは1回古い state でしかない。後ろなら書いたその回で
気づける。`always()` を付けてあるのは、deploy が途中で落ちた回こそ state に何が
残ったかを見たいため。

検査を2件足した（`infra/__tests__/workflows.test.ts`）。scrub が `cdkd deploy` より
後ろにあることと、`always()` が付いていること。順序を戻す変異と `always()` を
外す変異のどちらでも落ちる。

### スクリプト自身が打つ aws の資格情報

手順9 をマージした直後の deploy がここで落ちた。

```
aws: [ERROR]: An error occurred (AccessDenied) when calling the DescribeStacks operation:
  User: .../sakekasu-github-actions-deploy/GitHubActions is not authorized to perform:
  cloudformation:DescribeStacks on resource: .../sakekasu-dev-health-global/*
```

CI でワークフローが引き受けるのは `sakekasu-github-actions-deploy`。このロールは
`sts:AssumeRole` しか持たず、実権限は `sakekasu-cdkd-deploy` の側にある。cdkd は
`CDKD_ROLE_ARN` を自分で読んで引き受けるが、**`migrate-to-cdkd.sh` が直に打つ
`aws` コマンドには効かない**。手元から打つときは人間様の資格情報がそのまま権限を
持っているので、ここまで一度も出なかった。

スクリプトの側でも同じロールを引き受けるようにした。`aws_cli` を通して打ち、
`CDKD_ROLE_ARN` が無ければ素の `aws` に落ちる（手元から打つ経路）。

**引き受けた資格情報を環境変数として外に出さない。** cdkd にまで渡ると、
`sakekasu-cdkd-deploy` から `sakekasu-cdkd-deploy` を引き受けようとして落ちる
（信頼ポリシーが許すのは `sakekasu-github-actions-deploy` だけ）。呼び出しごとに
`env` で渡している。

`cfn_exists` は権限の失敗を握りつぶさず落とす作りだったので、スタックの有無を
取り違えたまま先へ進むことはなかった。`cdkd deploy` にも到達していない。

検査を4件足した。素の `aws` を打っていないこと、引き受けと失敗時の停止が
残っていること、資格情報を `export` していないこと、空配列の展開が bash 3.2 の
`set -u` で落ちない書き方であること。

### 型スキーマの読み取り権限

PR #230 の `cdkd diff` が毎回これを出していた。

```
Failed to resolve create-only properties for AWS::IAM::Policy via cloudformation:DescribeType
  (... is not authorized to perform: cloudformation:DescribeType ...).
  Falling back to cdkd's bundled schema snapshot for this resource — it can lag AWS's current
  schema, so a property AWS has since made updatable may be classified as a replacement.
```

cdkd は「作成時にしか指定できないプロパティ」を型ごとに `cloudformation:DescribeType` で引き、更新で済むか差し替えが要るかを判定する。引けないと同梱のスキーマ写しに落ちる。写しは AWS の現物より古くなりうるので、AWS 側で更新可能になったプロパティを差し替えと誤判定する余地が残る。DynamoDB テーブルのような作り直しの効かないものに当たると取り返しがつかない。

デプロイロールと diff ロールの両方に足した。公開された型のスキーマを読むだけなので、リソースは `arn:aws:cloudformation:*::type/resource/*` に絞ってある。**反映には OIDC スタックの手動デプロイが要る**（手順3 と同じ）。

```bash
cd infra
AWS_PROFILE=sakekasu-builder npx cdk deploy sakekasu-github-oidc -c github-oidc=true --require-approval never
```

### 9. ワークフローの差し替え

PR は取り込み（手順7）より先に用意しておき、手順8まで全部クリーンになったらすぐマージする。取り込みから差し替えまでの間は `cdk deploy --all` と実体がずれた状態になるため、窓を開けたままにしない。

- `npx cdk deploy --all --require-approval never` → `npx cdkd deploy --all --yes`
- `npx cdk diff --all --no-color` → `npx cdkd diff --all`
- `CDKD_ROLE_ARN` に `arn:aws:iam::<アプリのアカウント ID>:role/sakekasu-cdkd-deploy` を入れる
- `cdk-diff.yml` の diff ロールは `cdk-hnb659fds-lookup-role-*` への AssumeRole を消す（cdkd では使わない。読み取り権限は手順3の時点で付与済み）
- 待ちモードは既定のまま。デプロイ後にカナリアとアラームが動く構成なので `--no-wait` は使わない

**色はコメントに投稿する側で落とす。** cdkd に `--no-color` は無く、`NO_COLOR` も読まない（0.291.31 の `dist` に文字列が存在しない）。通常の出力は TTY でないと色が付かないが、**エラー出力には TTY でなくても付く**（PR #230 の最初の CI で、PR コメントに `\u001b[31m` が入った）。`cdkd` 側に逃げ道が無いので、コメントを組む `github-script` でエスケープシーケンスを落としている。

**diff ロールに cdkd のアセット保管庫への `s3:ListBucket` が要る。** cdkd は `diff` でもリージョンのアセット保管庫が自分のものかを確かめる。`ExpectedBucketOwner` 付きの `HeadBucket` で問い合わせ、権限が無いと 403 が返る。cdkd は 403 を「他アカウントのバケット」と解釈して止まるため、権限不足が乗っ取りに見えるエラーになる。

```
CdkdError: Asset bucket 'cdkd-assets-<アプリのアカウント ID>-ap-northeast-1' exists but is not owned by
account <アプリのアカウント ID> (or access is denied). Refusing to use it.
```

`HeadBucket` に要るのは `s3:ListBucket` だけで、中身を読む権限は要らない。ECR 側の `DescribeRepositories` は既存の `ecr:Describe*` で足りている。[cdkd-policies.ts](../infra/lib/cdkd-policies.ts) の `ProbeCdkdAssetStorage` がこれ。反映には `sakekasu-github-oidc` の手動デプロイが要る。

**`| tee` に流す run には `set -o pipefail` を付ける。** パイプの終了コードは `tee` のものになる。GitHub Actions の `run` は `bash -e` で動くが、`-e` はパイプライン全体の最後のコマンドしか見ないため、`cdkd` が落ちてもステップが成功扱いになる。実際に上のアセット保管庫のエラーが出たまま `diff` チェックが緑で通った。`pipefail` を立てたうえで、コメントを投稿するステップに `if: always()` を付けて、落ちてもエラー内容が PR に出るようにしている。

あわせて、セキュリティレビュー（PR #151）で挙がった2件をここで入れる。

**合成と差分を分ける。** いまの `cdk-diff.yml` は認証情報を入れたあとに `cdk diff` を走らせている。`--ignore-scripts` は npm のインストール時スクリプトを止めるが、CDK アプリのコードは合成時に実行されるため、PR に AWS SDK の呼び出しを仕込めば認証情報付きで動く。認証情報を入れる前に `npx cdk synth --all -q` を済ませ、そのあとは合成済みのアセンブリだけを読ませる（[#131](https://github.com/yuuuuuuu168/sakekasu-builder/issues/131) の1番）。

**これは部分的な対処。** 消えるのは「合成時にアプリのコードが走る」経路だけ。`infra/package-lock.json` は PR が書き換えられるので、`@go-to-k/cdkd` を自前のターゲットに差し替えれば、認証後に動く `cdkd` 自体が PR のコードになる。`--ignore-scripts` が止めるのはインストール時スクリプトで、意図して実行する本体には効かない。差し替え前の `cdk diff` も `aws-cdk` について同じ形だった。

`pull_request` ではワークフローの定義自体が PR のブランチから読まれるため、ワークフロー内の対策では閉じない。塞ぐには `pull_request_target` に移して信頼できる ref を checkout するか、PR のワークフローから OIDC を外すことになる。#131 の前提（private・fork 無し・PR を開けるのは admin 本人だけ）が変わる前にやる作業として、そちらに記録してある。

**「認証情報より前だから安全」ではない。** ジョブには `id-token: write` があるので、動いたコードは自分で OIDC トークンを取って `sts:AssumeRoleWithWebIdentity` でロールに入れる。認証ステップより前かどうかは関係がない。だから `infra/scripts/check-lockfile-registry.mjs` は依存の取得そのものより前に置いてある。

**取得元の検査は10本すべてを見る。** 認証情報の有無にかかわらずワークフローが取得・import する lockfile は、infra 本体の1本と lambda ごとの9本。`deploy.yml` は lambda ごとに `npm ci` を回し、`npm test` は `vitest.config` の include が lambda 配下の `__tests__` を拾うので、それらのモジュールと依存が読み込まれる。最初に書いた版は infra 本体しか見ておらず、9本が素通りしていた（PR #230 で aws-security-agent が指摘、HIGH）。

1本も見つからないときは異常として落とす。黙って何も検査しない状態が緑になるのを避けるため。

**合成のステップで `CDK_DEFAULT_ACCOUNT` を明示する。** この値は本来 CDK CLI が認証情報から入れる。認証前に合成すると undefined になり、`bin/app.ts` の `env.account` が未定義のスタックになって、テンプレート中のアカウント ID が `Ref: AWS::AccountId` に化ける。デプロイ時には同じ値に解決されるが、認証ありで合成した場合と別物のテンプレートになる。手元で測ると4スタックすべてで差が出た（auth 36行 / api 78行 / monitoring 79行 / health-global 62行）。#131 にも「PR #130 の作業中に実際に踏んだ」と記録がある。

渡し方は `CDKD_APP` 環境変数が楽。cdkd は `-a, --app` の値として「合成済みのクラウドアセンブリのディレクトリ」を受け取り、省略時は `CDKD_APP`、次に `cdk.json` の `app` を見る。ジョブの `env` に `CDKD_APP: cdk.out` を置けば、`migrate-to-cdkd.sh` の中から呼ばれる `cdkd import` まで含めて、どの呼び出しも合成し直さない。コマンドごとに `--app` を書き足すより漏れにくい。

CDK CLI 側のフォールバック（`cdk deploy`）には `--app cdk.out` を明示する。`CDKD_APP` は cdkd しか見ない。

`infra/__tests__/workflows.test.ts` が、合成が認証情報より前にあること、`CDKD_APP: cdk.out` があること、認証後に合成し直す CDK CLI の呼び出しが無いこと、`tee` に流す run に `pipefail` があること、投稿ステップに `if: always()` があることを検査する。

**state に平文が残っていないか見張る。** `npx cdkd scrub --all --dry-run --fail` を**デプロイの後ろ**に置く。現状このアプリの合成テンプレートに `{{resolve:secretsmanager:...}}` は無く、シークレットは ID を環境変数に置いて実行時に取りに行く作りなので平文が残る余地は無いが、将来そうなったときに気づけるようにしておく。

### `deploy.yml` から migrate-to-cdkd.sh を呼ぶ

ワークフローは `cdkd deploy` を直書きせず、先に `migrate-to-cdkd.sh` を通してから `engine` の値で分岐する。sakekasu-kakeibo と同じ形。

```yaml
- name: cdkd への取り込み状態を確かめる
  id: migrate
  run: bash scripts/migrate-to-cdkd.sh
- name: デプロイ（cdkd）
  if: steps.migrate.outputs.engine == 'cdkd'
  run: npx cdkd deploy --all --yes
- name: デプロイ（CloudFormation へのフォールバック）
  if: steps.migrate.outputs.engine == 'cfn'
  run: npx cdk deploy --all --require-approval never --app cdk.out
```

取り込みが済んでいれば、スクリプトは `cdkd state list` と4回の `describe-stacks` を打って `engine=cdkd` を返すだけで何もしない。

これが効くのは順番を間違えたとき。手順7 より先に手順9 をマージしても、state が空のまま `cdkd deploy` が走って全リソースを新規作成しにいく事故にならない。スクリプトがその場で取り込むか、前検査で引っかかれば何も触らずに `engine=cfn` を返して CloudFormation 側に流す。「手順9 を先にマージしない」という約束を、約束だけに頼らない形にしてある。

デプロイロールにはこの経路に必要な `cloudformation:UpdateStack` / `DeleteStack` / チェンジセット系が [cdkd-policies.ts](../infra/lib/cdkd-policies.ts) で入っている。

## health-global を外した

AWS Health の通知は、アカウント全体の話として共通基盤（sakekasu-integrated_environment の `docs/monitoring.md`）が持つことにした。ap-northeast-1 の `sakekasu-integrated-aws-health` と、us-east-1 から転送する `sakekasu-integrated-health-global` が同じことをするので、builder に残すと同じ通知が 2 通届く。

builder から外したのは2つ。

| 何を | どこ | どう消えるか |
| --- | --- | --- |
| ルール `dev-sakekasu-aws-health` | `sakekasu-dev-monitoring`（ap-northeast-1） | main へのマージで deploy が消す |
| スタック `sakekasu-dev-health-global`（ルール `dev-sakekasu-aws-health-global`、ロール `dev-sakekasu-health-forwarder` とそのインラインポリシー） | us-east-1 | **手で消す**（下の手順） |

監視スタックのトピックポリシーからは `events.amazonaws.com` の文が消え、`cloudwatch.amazonaws.com` の明示の許可だけが残る。トピックポリシー自体は残るので置き換わりは起きない（明示の許可を残している理由は `infra/lib/monitoring-stack.ts` のコメント）。

### us-east-1 のスタックが deploy で消えない理由

`cdkd deploy --all` の対象は合成結果に入っているスタックだけで、state にしか無いスタックには触らない（0.291.31 の `deploy` は `--all` のとき合成したスタックの一覧をそのまま対象にする）。アプリから外しただけでは `sakekasu-dev-health-global` の state と実物が us-east-1 に残り、グローバルの Health イベントを東京の default バスへ転送し続ける。転送先には共通基盤のルールが待っているので、共通基盤自身の転送と合わせてグローバル分だけ 2 通になる。

### deploy.yml で消さない理由

一度だけの `cdkd state destroy` を deploy に入れる案もあったが採らなかった。

- **CI のロールでは消せない。** `sakekasu-cdkd-deploy` の IAM の権限（`DeleteRole` / `DeleteRolePolicy`）は `role/sakekasu-*` に絞ってある。転送ロールの名前は `dev-sakekasu-health-forwarder` で、この範囲に入らない。ルールを消したところでロールの削除が AccessDenied になり、deploy が赤くなって state も中途半端に残る
- 通すにはデプロイロールの範囲を広げる必要があり、それには OIDC スタックの手動デプロイが要る。一度きりの削除のために、main への push から届く権限を広げるのは割に合わない
- 一度きりの破壊的な手順を CI に置くと、外し忘れたときに何をするのか読み手に分かりにくい

スタックの中身だけを空にして残す案も、空のスタックの state が残り続けて結局どこかで手で消すことになるので採らなかった。

### 手順（Mac から。マージ後の deploy が通ってから）

**マージより前に打たない。** main のアプリにまだ `sakekasu-dev-health-global` が入っている間に消すと、次の deploy が作り直す。

**`CDKD_ROLE_ARN` は渡さない。** 自分の権限で直接打つ（手順3 の末尾を参照）。

```bash
cd infra
export AWS_PROFILE=sakekasu-builder

# 1. 消す対象を確かめる。ルール・ロール・インラインポリシーの3つが出ること
npx cdkd state resources sakekasu-dev-health-global --stack-region us-east-1

# 2. 消す。リソースを消してから state も消す。確認を訊かれたら y
AWS_REGION=us-east-1 npx cdkd state destroy sakekasu-dev-health-global --stack-region us-east-1

# 3. 消えたことを確かめる
npx cdkd state list                                   # sakekasu-dev-health-global (us-east-1) が無いこと
aws events describe-rule --name dev-sakekasu-aws-health-global --region us-east-1   # ResourceNotFoundException
aws iam get-role --role-name dev-sakekasu-health-forwarder                          # NoSuchEntity
```

`cdkd state destroy` は合成を要らない版の destroy で、state に記録されたリソースを消してから state を消す。cdkd の destroy は state のリージョンにクライアントを切り替えるが、`import` のリージョンの取り違え（上の「cdkd の版と、先行リポジトリで判明している不具合」）と同じ形で踏まないよう、`AWS_REGION` も合わせておく。

インラインポリシーの手当て（「`cdkd export` はインラインポリシーの手当てが要る」）はここでは要らない。`AWS::IAM::Policy` の削除が物理 ID で空振りしても、ロールを消すときに cdkd がロールのインラインポリシーを `ListRolePolicies` で引いて実名で消してから `DeleteRole` を打つ。手順3 の `get-role` が NoSuchEntity を返せば、ポリシーごと消えている。

途中で落ちたら state は残るので、原因を直してもう一度 2 を打てばよい。同じリソースで落ち続けるときに限り、AWS 側を手で消してから `npx cdkd state orphan sakekasu-dev-health-global --stack-region us-east-1` で記録だけを外す。

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

**`export` の前に、そのスタックのインラインポリシーを実際の名前で消しておく。** 省くとフェーズ2 が必ず落ちる（手順6 の「`cdkd export` はインラインポリシーの手当てが要る」を参照）。対象は api 8 / monitoring 3 / auth 1 の計12個（health-global の1個はスタックごと外した）。名前は `cdkd export --dry-run` の「Phase 2 will also re-CREATE ...」に並ぶ論理 ID と同じで、`aws iam list-role-policies --role-name <ロール名>` でも引ける。

```bash
cd infra
export AWS_PROFILE=sakekasu-builder

# 戻す計画と、手当てが要るポリシーの一覧を見る
AWS_REGION=<スタックのリージョン> npx cdkd export sakekasu-dev-api --dry-run

# 一覧に出たぶんだけ、ロールから名前で消す
aws iam delete-role-policy --role-name <ロール名> --policy-name <論理ID>

AWS_REGION=<スタックのリージョン> npx cdkd export sakekasu-dev-api
```

`AWS_REGION` をスタックのリージョンに合わせるのは `import` と同じ。落ちたときの復旧は手順6 の「戻しがフェーズ2 で落ちたとき」にある。

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
