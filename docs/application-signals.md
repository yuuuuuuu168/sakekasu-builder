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

### サービス検出と Transaction Search（`infra/lib/monitoring-stack.ts`）

- `AWS::ApplicationSignals::Discovery` — Application Signals にサービスを見つけるための読み取り権限を与える。**これが無いと、計装してもサービスマップに何も出てこない**
- `AWS::XRay::TransactionSearchConfig` — X-Ray のスパンを CloudWatch Logs 側へ送り、トレースを検索できるようにする。インデックス率は 1%

どちらもアカウントに1つだけ置くリソースなので、監視の集約先である monitoring スタックに置いた。

ソムリエ（AgentCore Runtime）の GenAI Observability も Transaction Search が前提なので、ここに相乗りできる。

## デプロイ後にやること

main へマージすれば GitHub Actions が `cdk deploy --all` を実行する。手動デプロイは不要。

1. **サービスが出てくるまで待つ** — Application Signals コンソールの「Services」に2つの Lambda が現れる。デプロイ直後はデータが空で、検出まで数分から十数分かかる
2. **トレースを確認する** — 実際に画像をアップロードし、OCR を走らせてから「Transaction search」を見る。Bedrock / S3 への呼び出しがスパンとして分かれていれば通っている
3. **ソムリエのトレースを確認する** — GenAI Observability にソムリエ Runtime のトレースが出るか見る
4. **1週間後にコストを見る** — Cost Explorer で CloudWatch の増分を確認する

出てこないときは、まず Discovery が作られているかを疑う。次に関数の環境変数とレイヤーが実機に入っているかを見る。

```bash
AWS_PROFILE=sakekasu-builder aws lambda get-function-configuration \
  --function-name dev-sakekasu-ocr-analyzer --region ap-northeast-1 \
  --query '{Layers:Layers[].Arn,Wrapper:Environment.Variables.AWS_LAMBDA_EXEC_WRAPPER,Tracing:TracingConfig.Mode}'
```

## SLO をまだ入れていない理由

Issue #86 には SLO の定義とエラーバジェット消費アラームも挙げてあるが、この変更には含めていない。

SLO はしきい値（可用性 99%、レイテンシー p90 ≤ 15s など）を決めないと作れない。その値は実測を見てから決めるものなので、先に計装だけ入れてデータを溜める。当てずっぽうのしきい値で作ると、鳴りっぱなしか鳴らないかのどちらかになり、作り直すことになる。

決めるときの材料は Application Signals の「Service detail」に出る p50 / p90 / p99。1〜2週間ぶん見てから、`AWS::ApplicationSignals::ServiceLevelObjective`（CDK では `applicationsignals.CfnServiceLevelObjective`）で定義する。アラームは monitoring スタック側に置く。ApiStack に置くと通知先の SNS を参照して循環参照になる。

SLO 自体も Application Signals の課金対象なので、数を絞る。

## 費用

個人利用の規模なら月数十円から数百円の見込み。

- Transaction Search: 取り込み $0.35/GB + インデックス済みスパン $0.75/100万（先頭 1% は無料）
- 参考として、既存の監視スタックが月 $5 前後

インデックス率を上げると、そのぶんインデックス済みスパンの課金が増える。1% で始めて、トレースが足りなければ上げる。

## 注意点

- **コールドスタートが数百ms 悪化する。** ADOT のレイヤーを読み込むぶん。OCR は待つ前提の操作なので許容範囲とみているが、体感が悪くなったらメモリ増量で緩和する
- **レイヤーの ARN にはランタイムのバージョンが埋まっている**（`aws-otel-nodejs-amd64-ver-1-30-2`）。上げるときは `api-stack.ts` の `ADOT_NODEJS_LAYER_ARN` を差し替える。実在は `aws lambda get-layer-version-by-arn` で確認できる
- **アーキテクチャを x86_64 で明示している。** レイヤーが amd64 版なので、既定に任せて arm64 に変わると起動時に噛み合わなくなる
- **AppSync（JS リゾルバー）は Application Signals の対象外。** 必要なら AppSync 側の X-Ray トレーシングを別途有効にする（README の「Issue にしていない小さな宿題」）

## 参考

- [Enable your applications on Lambda](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Signals-Enable-LambdaMain.html)
- [ADOT Lambda Layer ARNs](https://aws-otel.github.io/docs/getting-started/lambda)
- [CloudWatch 料金](https://aws.amazon.com/cloudwatch/pricing)
