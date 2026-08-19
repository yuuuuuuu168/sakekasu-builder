# 既存のロググループをスタックへ取り込む手順

Lambda のログ保持期間の設定を、非推奨の `logRetention` から明示的な `logs.LogGroup` へ移すための AWS 側の作業メモ（[#129](https://github.com/yuuuuuuu168/sakekasu-builder/issues/129)）。

コードの変更だけでは移行が終わらない。既に存在するロググループを CloudFormation のスタックへ取り込む操作が要る。**2026-08-18 に dev の3スタックで実施済み。** ここに残すのは、実際に通った手順と、通らなかった道の記録。

## なぜ手作業が要るか

`logRetention` は、保持期間を設定するためだけのカスタムリソース（`Custom::LogRetention`）とその実体の Lambda をスタックに足す作りになっている。非推奨で、CDK v3 では消える。現行の推奨は `logs.LogGroup` を作って関数の `logGroup` に渡す形。

移行にあたって、ロググループ名は今と同じ `/aws/lambda/<関数名>` を明示している。名前が CDK の生成名に変わると `docs/` の調査コマンドと運用手順が全部変わり、過去のログも旧グループに取り残されるため。

そのぶん、既に同じ名前のロググループがあるアカウントでは、CloudFormation が新規作成に失敗する。

```
❌  sakekasu-dev-auth failed: ToolkitError: ChangeSet 'cdk-deploy-change-set' on stack
'sakekasu-dev-auth' failed early validation:
  - Resource of type 'AWS::Logs::LogGroup' with identifier
    '/aws/lambda/dev-sakekasu-signup-notifier' already exists.
    (at /Resources/SignupNotifierLogGroupF4C03A83)
```

チェンジセットの事前検証で弾かれるため、更新そのものが始まらない。ロールバックも起きず、スタックは `UPDATE_COMPLETE` のまま最終更新時刻も変わらない。ロググループもログ本体も触られない。

## 通った手順

CloudFormation の [auto-import](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/import-resources-automatically.html) を使う。通常の更新の中で、テンプレートに書かれた名前と一致する既存リソースを取り込む仕組み。`AWS::Logs::LogGroup` は対応する型に入っている。

`infra/` で、1スタックずつ実行する。

```sh
AWS_PROFILE=sakekasu-builder npx cdk deploy --import-existing-resources sakekasu-dev-auth
AWS_PROFILE=sakekasu-builder npx cdk deploy --import-existing-resources sakekasu-dev-api
AWS_PROFILE=sakekasu-builder npx cdk deploy --import-existing-resources sakekasu-dev-monitoring
```

これだけで済む。ロググループの取り込み、`Custom::LogRetention` とプロバイダー Lambda の削除、関数の `LoggingConfig` の配線が同じ更新に収まる。

取り込みの条件は次のとおりで、`lambdaLogGroup()` が作るロググループはすべて満たしている。

- テンプレートに静的な名前がある（`Ref` や関数で組み立てた名前は対象外）
- `DeletionPolicy` が `Retain` または `RetainExceptOnCreate`（`removalPolicy: RETAIN` で入る）
- 他のスタックに属していない
- 主識別子（`LogGroupName`）がテンプレートにある

**`--import-existing-resources` を `deploy.yml` に入れないこと。** 以後のデプロイで既存リソースを黙って取り込む口になる。名前がぶつかったときに気づけなくなるので、移行のときだけ手で打つ。

`--all` も使わない。1スタックずつ流して、それぞれの結果を見てから次へ進む。

## 順番

取り込みを先に、マージを後に。逆にすると、マージで走る `deploy.yml`（`cdk deploy --all`）が上のエラーで落ちる。

順番が入れ替わってしまっても壊れる方向には倒れない。#174 で実際に踏んだが、事前検証で止まるだけで何も適用されなかった。`cdk deploy --all` はスタックを1つずつ流すので、最初の `sakekasu-dev-auth` で止まり、後続には進まない。落ち着いて上の手順を流し、そのあと Actions から `deploy` を再実行すればよい。

取り込みが終わるまで `infra/` の変更を main に入れないこと。入れると同じところで落ち続ける。

## 対象

| スタック | アカウント | ロググループ | 状態 |
| --- | --- | --- | --- |
| `sakekasu-dev-auth` | 232791540685 | `/aws/lambda/dev-sakekasu-signup-notifier` | 取り込み済み（2026-08-18） |
| `sakekasu-dev-api` | 232791540685 | `/aws/lambda/dev-sakekasu-presigned-url`<br>`/aws/lambda/dev-sakekasu-ocr-analyzer` | 取り込み済み（2026-08-18） |
| `sakekasu-dev-monitoring` | 232791540685 | `/aws/lambda/dev-sakekasu-slack-notifier`<br>`/aws/lambda/dev-sakekasu-health-check`<br>`/aws/lambda/dev-sakekasu-sommelier-canary` | 取り込み済み（2026-08-18） |
| `sakekasu-billing-notifier` | <管理アカウント ID> | `/aws/lambda/sakekasu-billing-notifier`<br>`/aws/lambda/sakekasu-billing-slack-notifier` | 取り込み済み（2026-08-19）<br>保持期間は手で設定 |
| `sakekasu-dev-devops-agent` | 232791540685 | `/aws/lambda/dev-sakekasu-devops-agent-webhook` | 取り込み不要 |

`sakekasu-dev-devops-agent` は `agentSpaceArn` の context が入っているときだけ合成される。いまは入っておらずデプロイもされていないため、ロググループの実物が無い。初回デプロイのときに素直に作られる。

課金通知は管理アカウント側の手動デプロイ専用スタックなので別作業になる。同じフラグを付けて打つ。

```sh
npx cdk deploy --import-existing-resources sakekasu-billing-notifier -c billing=true
```

このスタックの2つは取り込む前の保持期間が無期限だったため、取り込みのあとに手で 30 日を設定した。理由は次の節にある。

## 検証

**取り込みは実物のプロパティを書き換えない。** ここが一番踏みやすい。CloudFormation はロググループをスタックの管理下に置くだけで、テンプレートに書いた `RetentionInDays` を実物へ適用しない。取り込む前の保持期間が 30 日でなければ、テンプレートは 30 日と言っているのに実物は違う、というドリフトになる。

`sakekasu-billing-notifier` で実際に踏んだ。取り込み自体は成功し、`Custom::LogRetention` も消えて過去のログも引き継いだが、保持期間は無期限のままだった。dev の3スタックでこうならなかったのは、取り込む前から 30 日が設定されていたため。

一度だけ実物に設定すれば、テンプレートと一致してドリフトも消える。以後は CDK の管理下なので、コード側で値を変えれば追随する。

```sh
AWS_PROFILE=<プロファイル> aws logs put-retention-policy \
  --log-group-name /aws/lambda/<関数名> --retention-in-days 30
```

そのうえで次を見る。

```sh
# 名前と保持期間。retentionInDays が 30 で、名前が変わっていないこと
AWS_PROFILE=sakekasu-builder aws logs describe-log-groups \
  --log-group-name-prefix /aws/lambda/dev-sakekasu \
  --query 'logGroups[].[logGroupName,retentionInDays]' --output table

# 過去のログが残っていること。取り込みなので消えないはずだが確かめる
AWS_PROFILE=sakekasu-builder aws logs describe-log-streams \
  --log-group-name /aws/lambda/dev-sakekasu-presigned-url \
  --order-by LastEventTime --descending --max-items 5

# メトリクスフィルターが生きていること（参照先が変わるため）
AWS_PROFILE=sakekasu-builder aws logs describe-metric-filters \
  --log-group-name /aws/lambda/dev-sakekasu-presigned-url

# Custom::LogRetention が消え、AWS::Logs::LogGroup が入っていること
AWS_PROFILE=sakekasu-builder aws cloudformation list-stack-resources \
  --stack-name sakekasu-dev-api \
  --query "StackResourceSummaries[?ResourceType=='Custom::LogRetention'||ResourceType=='AWS::Logs::LogGroup'].[LogicalResourceId,ResourceType]" \
  --output table
```

各 Lambda が起動してログを書けることも見る。実行ロールには `AWSLambdaBasicExecutionRole` が付いたままで権限は変わらないはずだが、合成結果だけでは分からない。画像を1枚上げて `dev-sakekasu-presigned-url` と `dev-sakekasu-ocr-analyzer` に新しいログが出れば足りる。

AWS が勧めているとおり、取り込みの直後にドリフト検出を掛ける。上の保持期間のずれは、ここでも `MODIFIED` として出る。

```sh
AWS_PROFILE=sakekasu-builder aws cloudformation detect-stack-drift --stack-name sakekasu-dev-api

AWS_PROFILE=sakekasu-builder aws cloudformation describe-stack-resource-drifts \
  --stack-name sakekasu-dev-api --stack-resource-drift-status-filters MODIFIED DELETED \
  --query 'StackResourceDrifts[].[LogicalResourceId,StackResourceDriftStatus]' --output table
```

## 通らなかった道

最初は `cdk import` による2段階の移行を組んだ。**この方式では通らない。** 同じところで詰まる人が出ないよう、理由を残す。

`cdk import` が使う IMPORT 型のチェンジセットは、追加以外を一切受け付けない。[公式ドキュメント](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/import-resources-manually.html)いわく "Import operations don't allow new resource creations, resource deletions, or changes to property configurations"。そのため取り込みと通常のデプロイを分ける必要があり、取り込みフェーズ用にコードを一時的に戻すパッチまで要った。

そこまで組んでも、最後に Outputs で止まる。

```
As part of the import operation, you cannot modify or add [Outputs]
```

`--force` は Resources にしか効かない。Outputs は別枠で、[KC の記事](https://repost.aws/knowledge-center/cloudformation-change-set-errors)にあるとおり `Logical ID` / `Description` / `Value` / `Export` のいずれも変更できない。

さらに厄介なことに、**このスタックの Outputs は一致させようがない**。`GetTemplate` が日本語を `?` に化けさせて返すため、CDK が合成する正しい日本語とも、取り出した `?` とも食い違う。実際に両方送って両方とも弾かれた。取り出したテンプレートをそのまま送り返しても同じで、こちらから一致させる手は無い。

auto-import は通常の更新なので、この制約がまるごと掛からない。2段階に分ける必要も、一時パッチも要らない。

なお `cdk diff` が日本語を含むリソースを毎回「変更あり」と報告するのは、この `GetTemplate` の化けが理由。実害は無いが、差分を読むときに混乱するので頭に入れておくとよい。

```
[~] AWS::Cognito::UserPool UserPool UserPool6BA7E5F2
 └─ [~] EmailVerificationSubject
     ├─ [-] sakekasu-builder ?????
     └─ [+] sakekasu-builder 確認コード
```

**`get-template` の出力を手で編集して投げ返さないこと。** 化けた `?` をそのまま書き戻すことになり、Cognito の確認メール本文と各リソースの説明文が壊れる。CDK 経由で入れれば合成結果の正しい日本語が使われるので、この事故は起きない。

## github-oidc のロググループについて

`sakekasu-github-oidc` スタックに、保持期間が無期限のロググループが2つ残る（[#127](https://github.com/yuuuuuuu168/sakekasu-builder/issues/127) の拾い漏れ）。

```
/aws/lambda/sakekasu-github-oidc-CustomAWSCDKOpenIdConnectProv-NiSIARa7Eld2
/aws/lambda/sakekasu-github-oidc-CustomAWSCDKOpenIdConnectProv-rzUg12vb0oOJ
```

`iam.OpenIdConnectProvider` が内部で作るカスタムリソースのものなので、`NodejsFunction` の `logGroup` では触れない。コンストラクト側にも保持期間を渡す口が無い（`OpenIdConnectProviderProps` は `url` / `clientIds` / `thumbprints` / `removalPolicy` だけ）。ロググループ名も CloudFormation が付けた関数名から決まるため合成時には分からず、CDK 側から同じ名前のロググループを書くこともできない。

コードでは対応せず、実物に手で保持期間を設定する。一度だけの操作。

```sh
for name in \
  /aws/lambda/sakekasu-github-oidc-CustomAWSCDKOpenIdConnectProv-NiSIARa7Eld2 \
  /aws/lambda/sakekasu-github-oidc-CustomAWSCDKOpenIdConnectProv-rzUg12vb0oOJ
do
  AWS_PROFILE=sakekasu-builder aws logs put-retention-policy \
    --log-group-name "$name" --retention-in-days 30
done
```

CDK の管理外なので、デプロイで上書きされることはない。関数が作り直されると新しい名前のロググループができるため、そのときは同じ操作をもう一度打つ。`github-oidc` は手動デプロイ専用のスタックで、触る機会は年に数回あるかどうか。

CDK には Lambda を使わない `OidcProviderNative`（`AWS::IAM::OIDCProvider`）があり、そちらへ移せばカスタムリソースごと消える。いまは移さない。OIDC プロバイダーは同じ URL で二重に登録できないため、作り直しが挟まると新旧が衝突して失敗する。落ちる先が GitHub Actions のデプロイ経路そのもので、自分を締め出す形になる。5KB のログのために踏む橋ではない。移すなら、締め出されても復旧できる手順を用意してからにする。

中身は CDK のカスタムリソースの実行ログで、利用者のデータは入らない。合計 5KB。
