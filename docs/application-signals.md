# CloudWatch Application Signals（#86）

障害が起きたときに「どこで詰まったか」をログの突き合わせで調べるのをやめるための仕組み。リクエスト単位のトレースと、レイテンシー・エラー率・リクエスト数のメトリクスを自動で集める。

既存の監視スタック（アラーム22件・外形監視・カナリア）は「異常が起きたこと」を知らせるところまでで、そこから先の切り分けは人力だった。ここを埋める。

## リポジトリに入っているもの

すべて CDK。コンソールでのワンクリック有効化は使っていない（同じ状態を再現できないため）。

### Lambda の計装（`infra/lib/api-stack.ts`）

`enableApplicationSignals()` が3つを付ける。

- ADOT のレイヤー（Node.js / x86_64）
- 環境変数 `AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-instrument`
- 実行ロールへ `CloudWatchLambdaApplicationSignalsExecutionRolePolicy`

あわせて X-Ray のアクティブトレースも有効にしている。レイヤーが起動時に割り込んで OpenTelemetry を仕込むので、関数のコードには手を入れていない。

対象は2つだけ。

| 関数 | 理由 |
|------|------|
| `dev-sakekasu-ocr-analyzer` | Bedrock を呼ぶぶん遅延もエラーも起きやすく、下流ごとの内訳を見たい |
| `dev-sakekasu-presigned-url` | 画像アップロードの入口。詰まると記録そのものが作れない |

監視系（health-check / slack-notifier / sommelier-canary / signup-notifier）は計装しない。監視の監視は既存のアラームで足りていて、増やすとノイズと費用だけが増える。テストでこの線引きを固定してあるので、計装を足すとテストが落ちて気づける。

### サービス検出と Transaction Search（アカウント単位・CDK 管理外）

計装が働くには、これら2つがアカウントで有効になっている必要がある。

- **サービス検出**（`AWS::ApplicationSignals::Discovery`）— Application Signals にサービスを見つけるための読み取り権限を与える。**これが無いと、計装してもサービスマップに何も出てこない**
- **Transaction Search**（`AWS::XRay::TransactionSearchConfig`）— X-Ray のスパンを CloudWatch Logs 側へ送り、トレースを検索できるようにする

このアカウントでは、どちらも 2026-08-04 にソムリエの GenAI Observability を入れたときから有効になっている。**CDK では管理していない。**

一度スタックに載せて失敗している。既に有効なので `AlreadyExists` で作成に失敗し、そのロールバックが「既に有効だった設定」を消しにいった（実際には無効化まで至らなかったが、片方のスタックの巻き戻しが他機能の可観測性を道連れにしうる形だった）。アカウントに1つしかない設定を、1つのスタックの寿命に紐づけるべきではない。

monitoring スタックのテストで「この2つをスタックが作らないこと」を固定してある。

現在の状態はこれで確認できる。

```bash
AWS_PROFILE=sakekasu-builder aws xray get-trace-segment-destination --region ap-northeast-1
# → { "Destination": "CloudWatchLogs", "Status": "ACTIVE" }

AWS_PROFILE=sakekasu-builder aws iam get-role \
  --role-name AWSServiceRoleForCloudWatchApplicationSignals --query 'Role.RoleName'
# → サービス検出が有効なら存在する
```

新しいアカウントに展開するときは、先にここを有効にする。

```bash
# Transaction Search
AWS_PROFILE=<profile> aws xray update-trace-segment-destination \
  --destination CloudWatchLogs --region ap-northeast-1

# サービス検出（コンソールの Application Signals から有効化しても同じ）
AWS_PROFILE=<profile> aws application-signals start-discovery --region ap-northeast-1
```

## デプロイ後にやること

main へマージすれば GitHub Actions が `cdk deploy --all` を実行する。手動デプロイは不要。

1. **サービスが出てくるまで待つ** — Application Signals コンソールの「Services」に2つの Lambda が現れる。デプロイ直後はデータが空で、検出まで数分から十数分かかる
2. **トレースを確認する** — 実際に画像をアップロードし、OCR を走らせてから「Transaction search」を見る。Bedrock / S3 への呼び出しがスパンとして分かれていれば通っている
3. **ソムリエのトレースを確認する** — GenAI Observability にソムリエ Runtime のトレースが出るか見る
4. **ログの保持期間を設定する**（下記）
5. **トレースに利用者の識別子が入っていないか確認する**（下記）
6. **1週間後にコストを見る** — Cost Explorer で CloudWatch の増分を確認する

出てこないときは、まずサービス検出が有効かを疑う（上記の `get-role`）。次に関数の環境変数とレイヤーが実機に入っているかを見る。

```bash
AWS_PROFILE=sakekasu-builder aws lambda get-function-configuration \
  --function-name dev-sakekasu-ocr-analyzer --region ap-northeast-1 \
  --query '{Layers:Layers[].Arn,Wrapper:Environment.Variables.AWS_LAMBDA_EXEC_WRAPPER,Tracing:TracingConfig.Mode}'
```

### ログの保持期間を設定する

Application Signals と Transaction Search が使うロググループは AWS 側が自動で作る。既定の保持期間は無期限なので、出てきたら設定する。CDK からは触れない（まだ存在しないものに保持期間は付けられないし、同名で作ろうとすると衝突する）。

```bash
for lg in /aws/application-signals/data aws/spans; do
  AWS_PROFILE=sakekasu-builder aws logs put-retention-policy \
    --log-group-name "$lg" --retention-in-days 30 --region ap-northeast-1
done
```

X-Ray のトレースそのものは30日で消える（X-Ray 側の固定値で変更できない）。保持期間を設定するのは、Transaction Search が Logs 側に送るぶん。

### トレースに利用者の識別子が入っていないか確認する

S3 のキーは `<Cognito の sub>/<種別>/<記録 ID>/<ファイル名>` という形をしている。計装が AWS SDK の呼び出しパラメータをスパンに載せる実装だと、この sub がトレースに残ることになる。sub は利用者ごとに固定の UUID なので、残るなら扱いを決めておきたい。

OpenTelemetry の JS 版 AWS SDK 計装は S3 専用の拡張を持たず、記録するのは呼び出したサービス名と操作名までなので、そのままでは載らない見込み。ただしバージョンによって変わりうるので、最初のトレースが出た時点で実際に見て確かめる。

```bash
# GetObject / DeleteObject のスパンに S3 のキーが含まれていないかを見る
AWS_PROFILE=sakekasu-builder aws logs start-query \
  --log-group-name aws/spans \
  --start-time $(( $(date +%s) - 3600 )) --end-time $(date +%s) \
  --query-string 'fields @message | filter @message like /GetObject/ | limit 5' \
  --region ap-northeast-1
```

実際に載っていたら、キーの構造を変える（sub をハッシュ化する、階層から外す）か、スパンプロセッサで該当の属性を落とす。

属性の値を一律で切り詰める `OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT=0` は使わない。全部の属性が潰れて、下流ごとの内訳という計装の目的そのものが消えるため。

## SLO をまだ入れていない理由

Issue #86 には SLO の定義とエラーバジェット消費アラームも挙げてあるが、この変更には含めていない。

SLO はしきい値（可用性 99%、レイテンシー p90 ≤ 15s など）を決めないと作れない。その値は実測を見てから決めるものなので、先に計装だけ入れてデータを溜める。当てずっぽうのしきい値で作ると、鳴りっぱなしか鳴らないかのどちらかになり、作り直すことになる。

決めるときの材料は Application Signals の「Service detail」に出る p50 / p90 / p99。1〜2週間ぶん見てから、`AWS::ApplicationSignals::ServiceLevelObjective`（CDK では `applicationsignals.CfnServiceLevelObjective`）で定義する。アラームは monitoring スタック側に置く。ApiStack に置くと通知先の SNS を参照して循環参照になる。

SLO 自体も Application Signals の課金対象なので、数を絞る。

## 費用

個人利用の規模なら月数十円から数百円の見込み。

- Transaction Search: 取り込み $0.35/GB + インデックス済みスパン $0.75/100万（先頭 1% は無料）
- 参考として、既存の監視スタックが月 $5 前後

インデックス率は現在 100%（`Default` ルール）。当初は 1% にするつもりだったが、この規模では 100% のままでよい。OCR とソムリエを合わせて月に数百リクエスト、1リクエストあたり10スパンとしても月数千スパンで、$0.75/100万 に対して完全に誤差になる。むしろ 1% にするとトレースがほとんど残らず、障害時に見たいリクエストが入っていない状態になる。

リクエスト数が桁で増えたら下げる。

```bash
AWS_PROFILE=sakekasu-builder aws xray get-indexing-rules --region ap-northeast-1
```

## 注意点

- **コールドスタートが数百ms 悪化する。** ADOT のレイヤーを読み込むぶん。OCR は待つ前提の操作なので許容範囲とみているが、体感が悪くなったらメモリ増量で緩和する
- **レイヤーの ARN にはランタイムのバージョンが埋まっている**（`aws-otel-nodejs-amd64-ver-1-30-2`）。上げるときは `api-stack.ts` の `ADOT_NODEJS_LAYER_ARN` を差し替える。実在は `aws lambda get-layer-version-by-arn` で確認できる。自動で追随する仕組みは入れていないので、[ADOT のリリース](https://github.com/aws-observability/aws-otel-lambda/releases)をたまに見る
- **アーキテクチャを x86_64 で明示している。** レイヤーが amd64 版なので、既定に任せて arm64 に変わると起動時に噛み合わなくなる
- **リージョンを変えるならレイヤーの ARN も差し替える。** レイヤーは同じリージョンのものしか付けられない。合成の時点で止まるようにしてあるので、忘れて気づかないままデプロイされることはない
- **AppSync（JS リゾルバー）は Application Signals の対象外。** 必要なら AppSync 側の X-Ray トレーシングを別途有効にする（README の「Issue にしていない小さな宿題」）

## 参考

- [Enable your applications on Lambda](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Signals-Enable-LambdaMain.html)
- [ADOT Lambda Layer ARNs](https://aws-otel.github.io/docs/getting-started/lambda)
- [CloudWatch 料金](https://aws.amazon.com/cloudwatch/pricing)
