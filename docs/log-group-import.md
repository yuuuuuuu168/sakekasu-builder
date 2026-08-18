# ロググループを cdk import で取り込む手順

Lambda のログ保持期間の設定を、非推奨の `logRetention` から明示的な `logs.LogGroup` へ移すための AWS 側の作業メモ（[#129](https://github.com/yuuuuuuu168/sakekasu-builder/issues/129)）。

コードの変更だけでは移行は完了しない。既存のロググループを CloudFormation のスタックへ取り込む操作が要る。

## なぜ手作業が要るか

`logRetention` は、保持期間を設定するためだけのカスタムリソース（`Custom::LogRetention`）とその実体の Lambda をスタックに足す作りになっている。非推奨で、CDK v3 では消える。現行の推奨は `logs.LogGroup` を作って関数の `logGroup` に渡す形。

移行にあたって、ロググループ名は今と同じ `/aws/lambda/<関数名>` を明示している。名前が CDK の生成名に変わると `docs/` の調査コマンドと運用手順が全部変わり、過去のログも旧グループに取り残されるため。

そのぶん、既に同じ名前のロググループがあるアカウントでは CloudFormation が新規作成に失敗する（`AlreadyExists`）。実物を先にスタックへ取り込んでおけば、削除も名前変更もせずに移行できる。

### 2段階になる理由

CloudFormation の import は追加しか受け付けない。[公式ドキュメント](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/import-resources-manually.html)いわく "Import operations don't allow new resource creations, resource deletions, or changes to property configurations"。

この移行には3種類の変更が混ざっている。

1. `AWS::Logs::LogGroup` の追加
2. `Custom::LogRetention` とプロバイダー Lambda の削除
3. 関数の `LoggingConfig` の変更（作ったロググループを指す）

1つの操作にまとめられないので、取り込み（1だけ）と通常のデプロイ（2と3）に分ける。

## 対象

`Custom::LogRetention` を持つスタックすべて。ロググループの実物がまだ無いスタックは取り込みが要らない。

| スタック | アカウント | ロググループ | 取り込み |
| --- | --- | --- | --- |
| `sakekasu-dev-auth` | 232791540685 | `/aws/lambda/dev-sakekasu-signup-notifier` | 要 |
| `sakekasu-dev-api` | 232791540685 | `/aws/lambda/dev-sakekasu-presigned-url`<br>`/aws/lambda/dev-sakekasu-ocr-analyzer` | 要 |
| `sakekasu-dev-monitoring` | 232791540685 | `/aws/lambda/dev-sakekasu-slack-notifier`<br>`/aws/lambda/dev-sakekasu-health-check`<br>`/aws/lambda/dev-sakekasu-sommelier-canary` | 要 |
| `sakekasu-billing-notifier` | <管理アカウント ID> | `/aws/lambda/sakekasu-billing-notifier`<br>`/aws/lambda/sakekasu-billing-slack-notifier` | 要（手動デプロイのスタックなので別作業） |
| `sakekasu-dev-devops-agent` | 232791540685 | `/aws/lambda/dev-sakekasu-devops-agent-webhook` | 不要 |

`sakekasu-dev-devops-agent` は `agentSpaceArn` の context が入っているときだけ合成される。いまは入っておらずデプロイもされていないため、ロググループの実物が無い。初回デプロイのときに素直に作られる。

## 順番

取り込みを先に、マージを後に。逆にすると、マージで走る `deploy.yml`（`cdk deploy --all`）が存在するロググループを作りにいって `AlreadyExists` で落ちる。

取り込みからマージまでの間、`infra/` の変更を main に入れない。取り込み済みのロググループは main のテンプレートにまだ無いので、その状態で他のデプロイが走るとスタックから外れてしまう。`DeletionPolicy: Retain` なので実物は残るが、宙に浮いた状態からもう一度取り込み直すことになる。

### 先にマージしてしまったら

慌てなくてよい。壊れる方向には倒れない。#174 で実際に踏んだので、そのときの結果を書いておく。

`cdk deploy --all` は**チェンジセットの事前検証で弾かれる**。更新そのものが始まらないため、ロールバックすら起きない。

```
❌  sakekasu-dev-auth failed: ToolkitError: ChangeSet 'cdk-deploy-change-set' on stack
'sakekasu-dev-auth' failed early validation:
  - Resource of type 'AWS::Logs::LogGroup' with identifier
    '/aws/lambda/dev-sakekasu-signup-notifier' already exists.
    (at /Resources/SignupNotifierLogGroupF4C03A83)
```

`cdk deploy --all` はスタックを1つずつ流すので、最初の `sakekasu-dev-auth` で止まり、`sakekasu-dev-api` と `sakekasu-dev-monitoring` には進まない。3スタックとも `UPDATE_COMPLETE` のまま、最終更新時刻も変わらない。ロググループもログ本体も触られず、保持期間 30 日のまま残る。

失敗するのは、既存のロググループと同じ名前を作ろうとするからで、ここまでは移行の前提どおり。取り込みを済ませてからデプロイをやり直せば、そのまま先へ進む。

立て直しは、やることの順番が入れ替わるだけ。

1. この文書の手順1〜3をそのまま実行する。一時パッチは main に当てる。デプロイされているのはマージ前の状態のままなので、「デプロイ済み + ロググループ」という関係は変わらない
2. マージは済んでいるので、手順4の代わりに Actions から `deploy` を再実行する

取り込みが終わるまで `infra/` の変更を main に入れないのは同じ。入れると同じところで落ち続ける。

## 手順

`infra/` で実行する。プロファイルは `sakekasu-builder`。

### 1. 取り込み用に一時的なパッチを当てる

取り込みのフェーズでは、テンプレートが「いまデプロイされているもの + ロググループ」でなければならない。`logRetention` を残したまま、ロググループだけを先に生やす形にする。

各スタックのすべての関数について、次のように書き換える。`this` に足すだけで関数には渡さない。

```diff
+    lambdaLogGroup(this, 'PresignedUrlLogGroup', presignedUrlFunctionName);
     this.presignedUrlFunction = new NodejsFunction(this, 'PresignedUrlFunction', {
       functionName: presignedUrlFunctionName,
       runtime: Runtime.NODEJS_22_X,
-      logGroup: lambdaLogGroup(this, 'PresignedUrlLogGroup', presignedUrlFunctionName),
+      logRetention: LAMBDA_LOG_RETENTION,
```

`LAMBDA_LOG_RETENTION` の import を戻すのも忘れずに。構造上の ID（`PresignedUrlLogGroup`）は変えないこと。ここが変わると論理 ID が変わり、手順4のデプロイが取り込んだものを作り直しにいく。

このパッチは `npm test` で落ちる。非推奨の `logRetention` が残っていないかを見張るテストがあるため。落ちるのが正しい。commit しないための歯止めとして置いてある。

### 2. cdk diff で中身を確かめる

```sh
AWS_PROFILE=sakekasu-builder npx cdk diff --strict sakekasu-dev-auth
```

`AWS::Logs::LogGroup` の追加に加えて、**日本語を含むリソースが軒並み変更として出る**。これは実際のずれではない。理由は次の「非 ASCII の幻の差分」に書いた。

追加と、そこに挙げた種類の変更以外が出たら止める。main と AWS の状態がずれているということなので、先にそちらを揃える。

### 3. cdk import で取り込む

1スタックずつ実行する。3つ同時には触らない。

ロググループ名は対話で聞かれるが、打ち間違いを避けるため対応表のファイルを渡す。`sakekasu-dev-auth` ならこう書く。

```json
{
  "SignupNotifierLogGroupF4C03A83": { "LogGroupName": "/aws/lambda/dev-sakekasu-signup-notifier" }
}
```

論理 ID は手順1のパッチを当てた状態で `npx cdk synth` すれば出る。3スタックぶんの値は次のとおり（2026-08-17 時点で確認済み）。

| スタック | 論理 ID | ロググループ |
| --- | --- | --- |
| `sakekasu-dev-auth` | `SignupNotifierLogGroupF4C03A83` | `/aws/lambda/dev-sakekasu-signup-notifier` |
| `sakekasu-dev-api` | `PresignedUrlLogGroup131ACA41` | `/aws/lambda/dev-sakekasu-presigned-url` |
| `sakekasu-dev-api` | `OcrAnalyzerLogGroup35C7BA9F` | `/aws/lambda/dev-sakekasu-ocr-analyzer` |
| `sakekasu-dev-monitoring` | `SlackNotifierLogGroup8A643683` | `/aws/lambda/dev-sakekasu-slack-notifier` |
| `sakekasu-dev-monitoring` | `HealthCheckLogGroupC9F0564D` | `/aws/lambda/dev-sakekasu-health-check` |
| `sakekasu-dev-monitoring` | `SommelierCanaryLogGroup0E2A4673` | `/aws/lambda/dev-sakekasu-sommelier-canary` |

まずチェンジセットを作るだけにして、中身を見てから実行する。

```sh
AWS_PROFILE=sakekasu-builder npx cdk import sakekasu-dev-auth \
  --resource-mapping auth-import.json --force --no-execute
```

`--force` が要る理由は次節。`--no-execute` を付けるとチェンジセットが残るので、`describe-change-set` で中身を見る。`Action` が `Import` のものだけになっていることを確かめる。

```sh
AWS_PROFILE=sakekasu-builder aws cloudformation describe-change-set \
  --stack-name sakekasu-dev-auth --change-set-name <名前> \
  --query 'Changes[].ResourceChange.[Action,LogicalResourceId]' --output table
```

良ければ実行する。`--no-execute` を外してもう一度打つか、チェンジセットをそのまま実行する。

終わったら次のスタックへ。`sakekasu-dev-api`、`sakekasu-dev-monitoring` の順。

### 4. パッチを捨てて PR をマージする

```sh
git checkout -- lib/
```

マージすると `deploy.yml` が `cdk deploy --all` を流し、`Custom::LogRetention` とそのプロバイダー Lambda が消え、関数が取り込んだロググループを指すようになる。

### 5. 課金通知のスタック

管理アカウント（<管理アカウント ID>）の認証情報で、同じことをもう一度やる。こちらは Actions に乗らないので、デプロイも手で打つ。

```sh
npx cdk import sakekasu-billing-notifier -c billing=true \
  --resource-mapping billing-import.json --force --no-execute
npx cdk deploy sakekasu-billing-notifier -c billing=true
```

```json
{
  "BillingNotifierLogGroup8184291A": { "LogGroupName": "/aws/lambda/sakekasu-billing-notifier" },
  "SlackNotifierLogGroup8A643683": { "LogGroupName": "/aws/lambda/sakekasu-billing-slack-notifier" }
}
```

論理 ID は合成結果から取った値だが、**このアカウントの実際の状態は未確認**。読み取り用の `verify` プロファイルはアプリ本体のアカウント（232791540685）しか見られないため。ロググループが実在するか、`Custom::LogRetention` がいくつあるかは、作業の前に自分の目で確かめること。

## 非 ASCII の幻の差分

`cdk diff` と `cdk import` は、日本語を含むリソースを毎回「変更あり」と報告する。

```
[~] AWS::Cognito::UserPool UserPool UserPool6BA7E5F2
 └─ [~] EmailVerificationSubject
     ├─ [-] sakekasu-builder ?????
     └─ [+] sakekasu-builder 確認コード
```

**実体は正しく、CloudFormation の `GetTemplate` が読み出しで化けさせているだけ。** 2026-08-17 に次の3点で確かめた。

1. AWS CLI（Python）でも AWS SDK for JavaScript でも同じ `?` が返る。手元のロケールや CLI の問題ではなく、API の応答がそうなっている
2. Cognito のユーザープール本体を `describe-user-pool` で見ると、`EmailVerificationSubject` は `sakekasu-builder 確認コード` と正しく入っている。CloudFormation は正しい UTF-8 を受け取って適用している
3. `describe-stack-events` を見ると、直近のデプロイで `UserPool6BA7E5F2` は一度も更新されていない。保存されている値が `?` なら、CDK が毎回正しい日本語を送っている以上、毎デプロイで更新が走るはず

つまり保存されている値は正しく、読み出しの経路だけが壊れている。デプロイでは何も起きないが、`cdk import` はこの読み出しと合成結果を比べるため、追加以外の変更があると見なして中断する。

```
No resource updates or deletes are allowed on import operation.
```

`--force` はこの中断を飛ばす。**飛ばして安全なのは、CloudFormation 側が自分の保存している正しいテンプレートと比べるため。** 変更なしと判断されるので、IMPORT のチェンジセットは取り込みだけを含む。それでも `--no-execute` で中身を見てから実行する。もし本物の変更が紛れていれば CloudFormation がチェンジセットの作成で落とすので、実行前に止まる。

`AWS::CDK::Metadata` も変更として出る。こちらは幻ではなく、ロググループのコンストラクトが増えたぶん解析用の文字列が変わるため。何もしないリソースなので実害は無い。

**`get-template` の出力を手で編集して投げ返さないこと。** 化けた `?` をそのまま書き戻すことになり、Cognito の確認メール本文と各リソースの説明文が本当に壊れる。CDK 経由で入れれば合成結果の正しい日本語が使われるので、この事故は起きない。

## 事前確認の結果（2026-08-17）

読み取り専用の `verify` プロファイルで確認済み。

- `dev-sakekasu-*` のロググループ6つはすべて実在し、保持期間は 30 日。名前もこの移行で作る `/aws/lambda/<関数名>` と一致する
- 3スタックに `Custom::LogRetention` が計6個。`AWS::Logs::LogGroup` はまだ1つも無い
- `sakekasu-dev-devops-agent` は存在しない（`agentSpaceArn` が未設定のため）。取り込みは要らない
- main と AWS の状態は一致している（非 ASCII の幻の差分を除く）
- 手順1のパッチを当てた合成結果は、既存リソースが `AWS::CDK::Metadata` を除いて main と一字一句同じで、ロググループ6つが増えるだけ。論理 ID は最終形と一致する

## 検証

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
```

各 Lambda が起動してログを書けることも見る。実行ロールには `AWSLambdaBasicExecutionRole` が付いたままで権限は変わらないはずだが、合成結果だけでは分からない。画像を1枚上げて `dev-sakekasu-presigned-url` と `dev-sakekasu-ocr-analyzer` に新しいログが出れば足りる。

`Custom::LogRetention` が消えたことも確かめる。

```sh
AWS_PROFILE=sakekasu-builder aws cloudformation list-stack-resources \
  --stack-name sakekasu-dev-api \
  --query "StackResourceSummaries[?ResourceType=='Custom::LogRetention']"
```

## 途中で止まったとき

IMPORT のチェンジセットは実行前なら捨てられる。実行後に失敗した場合、CloudFormation は取り込みをロールバックするだけで、ロググループの実物には触らない。取り込みは「スタックが実物を知っているかどうか」を変える操作で、ログそのものは動かない。

手順3まで済んで手順4のデプロイが落ちた場合、スタックにはロググループがあり、関数はまだ `Custom::LogRetention` を見ている状態になる。どちらも動作としては正しい（保持期間は両方から 30 日に設定される）ので、慌てて戻さず原因を見てからやり直す。

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
