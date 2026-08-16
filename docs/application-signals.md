# CloudWatch Application Signals（#86）

障害が起きたときに「どこで詰まったか」をログの突き合わせで調べるのをやめるための仕組み。リクエスト単位のトレースと、レイテンシー・エラー率・リクエスト数のメトリクスを自動で集める。

既存の監視スタック（アラーム22件・外形監視・カナリア）は「異常が起きたこと」を知らせるところまでで、そこから先の切り分けは人力だった。ここを埋める。

## いま入っているもの / 入っていないもの

**計装は対象の2関数に入っている。** 一度入れて本番を止めて切り戻し（PR #114）、原因を突き止めてから `ocr-analyzer`（PR #126、2026-08-10）、`presigned-url`（2026-08-16）の順に入れ直した。経緯は Issue #86 のコメントにまとめてある。

| 要素 | 状態 |
|------|------|
| Transaction Search | 有効（2026-08-04〜）。アカウント単位・CDK 管理外 |
| サービス検出（Discovery） | 有効（同上） |
| X-Ray アクティブトレース | 有効（`ocr-analyzer` / `presigned-url`） |
| アーキテクチャの明示（`x86_64`） | 入っている |
| レイヤー・起動ラッパー・IAM ポリシー | `ocr-analyzer`（2026-08-10）と `presigned-url`（2026-08-16）の両方に入っている |

下流ごとの内訳（Bedrock に何秒、S3 に何秒）が見えるのは計装した関数だけなので、監視系の4関数については従来どおり Lambda 標準メトリクス由来のエラー率と実行時間までになる。

なお、計装が無い状態でもエラー率は見えるので、それで既存のバグを1件見つけている（Issue #115）。

### 一度切り戻した理由（PR #110 → #114）

**Node.js 向けの AWS 製レイヤーは2種類あり、起動ラッパーの名前が違う。** これを取り違えた。

| レイヤー | 起動ラッパー |
|---|---|
| `AWSOpenTelemetryDistroJs`（Application Signals 用） | `/opt/otel-instrument` |
| `aws-otel-nodejs-amd64-ver-*`（汎用 ADOT） | `/opt/otel-handler` |

前回は**汎用 ADOT のレイヤーに、Application Signals 用のラッパー名を組み合わせた**。存在しないパスを指定すると、ラッパーの解決に失敗した時点で関数が `Runtime.ExitError` で落ちる。ハンドラに到達しないので 100% 失敗する。

当時は「`/opt/otel-instrument` は Python 用の名前だった」と結論づけたが、**これは誤り**だった。Application Signals 用のレイヤーでは Node.js でもこの名前が正しい。ラッパー名だけを見ても正誤は決まらず、**レイヤーとの組み合わせで決まる**。

根本の失敗は変わらない。レイヤーの ARN が実在することは確認していたが、中身にラッパーがあるかは見ていなかった。

### 計装する対象（再挑戦時も同じ）

| 関数 | 理由 |
|------|------|
| `dev-sakekasu-ocr-analyzer` | Bedrock を呼ぶぶん遅延もエラーも起きやすく、下流ごとの内訳を見たい |
| `dev-sakekasu-presigned-url` | 画像アップロードの入口。詰まると記録そのものが作れない |

監視系（health-check / slack-notifier / sommelier-canary / signup-notifier）は計装しない。監視の監視は既存のアラームで足りていて、増やすとノイズと費用だけが増える。

**1関数ずつ入れた。** 前回は2つ同時に入れて両方止め、画像アップロードの動線ごと失った。今回は `ocr-analyzer`（2026-08-10）を先にして6日ぶん動かし、そのあと `presigned-url`（2026-08-16）に広げている。OCR が落ちても記録の登録自体は通る（解析だけが失敗する）ので、被害が動線を塞がない側から試した。

対象を増やすときも同じにする。3つ目を足す理由が出てきたら、既存の2つが安定していることを確かめてから1つずつ。

計装の3点（レイヤー・起動ラッパー・IAM ポリシー）は `api-stack.ts` の `enableApplicationSignals()` にまとめてある。関数ごとに3行を書き写す形だと、増やすときに1つ書き落とす。落としたときの壊れ方は3通りで、レイヤーを落とすと関数が起動しなくなる（PR #110 がこれ）。

テストは3つ置いてある。

| テスト | 見ているもの |
|---|---|
| `api-stack.test.ts` の「レイヤーとラッパーが揃っている」 | 対象2関数それぞれのレイヤーとラッパーの組み合わせ |
| `api-stack.test.ts` の「起動ラッパーを指定した関数には必ずレイヤーが付いている」 | 片方だけの状態（起動不能）が入り込んでいないか。関数を限定せず横断で見る |
| `lambda-config.test.ts` の「対象の2関数だけに入っている」 | 監視系など、意図的に外した関数へ広がっていないか |

最後の1つは全スタックを合成して見ているので、対象を増やすときはここが落ちる。この文書の判断（監視系は入れない）と一緒に更新すること。

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

main へマージすれば GitHub Actions が自動デプロイする。手動デプロイは不要。

**ただしデプロイの成功と関数が起動することは別。** 計装を入れたら、必ず実際のリクエストを1回通して `Runtime.ExitError` が出ないことを確かめる。前回はここを飛ばして本番を止めた。

```bash
for fn in dev-sakekasu-presigned-url dev-sakekasu-ocr-analyzer; do
  echo "--- $fn"
  AWS_PROFILE=sakekasu-builder aws logs tail "/aws/lambda/$fn" \
    --since 5m --region ap-northeast-1 | grep -E "ExitError|does not exist"
done
```

`presigned-url` は画像アップロードの入口なので、通すのはアプリから実際に1枚アップロードするのがいちばん早い。URL の発行が通れば起動している。ここが落ちていると記録そのものが作れなくなるため、**ログを見るのはデプロイ完了の通知を待ってからではなく、その場で**。

### 計装を入れたあとにやること

1. **サービスが計装済みになるまで待つ** — 一覧の `InstrumentationType` が `UNINSTRUMENTED` から変わる。デプロイ直後はデータが空で、反映まで数分から十数分かかる
2. **トレースを確認する** — 実際に画像をアップロードし、OCR を走らせてから「Transaction search」を見る。Bedrock / S3 への呼び出しがスパンとして分かれていれば通っている。分かれていなければ ESM バンドルを疑う（下記の注意点）
3. **ソムリエのトレースを確認する** — GenAI Observability にソムリエ Runtime のトレースが出るか見る
4. **トレースに利用者の識別子が入っていないか確認する**（下記）
5. **1週間後にコストを見る** — Cost Explorer で CloudWatch の増分を確認する

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

## コンソール（APM observability summary）の見方

このページは**サービスの健全性を表すものではない**。「AWS が推奨する監視項目をどれだけ埋めたか」のチェックリストで、未達の項目が並ぶ。全部埋めるのが正解ではないので、埋めない項目は理由を持っておけばよい。

2026-08-10 時点の表示と、このプロジェクトでの扱い。

| 表示 | Application Signals で解消するか | 扱い |
|------|--------------------------------|------|
| Services instrumented（1 / 9 not） | **する** | 計装を入れれば増える。ただし 10/10 にはならない |
| Services with SLOs（10 without） | しない | SLO はしきい値を人が決めて定義するもの。数個に絞る |
| Services with AppMonitors（10 without RUM） | **別サービス** | CloudWatch RUM。ブラウザ側の実ユーザー監視で、サーバー側の話ではない |
| Services with Canaries（10 without） | **別サービス** | CloudWatch Synthetics。自作のカナリアで足りている |

### 「10 services」の内訳

計装する意味のあるサービスは全体の一部でしかない。

| サービス | 扱い |
|---------|------|
| `ocr-analyzer` / `presigned-url` | 計装する（この文書の対象） |
| `sommelier_sommelier.DEFAULT`（AgentCore） | 既に計装済み（GenAI Observability） |
| `health-check` / `slack-notifier` / `sommelier-canary` / `signup-notifier` | 意図的に対象外 |
| `LogRetention` × 2 / `CustomAWSCDKOpenIdConnectProv` | CDK が裏で作るカスタムリソース。対象外 |

2関数が入ったので「4 instrumented / 6 not」あたりに落ち着く見込み（ソムリエと合わせて4）。反映には時間ウィンドウぶんの遅れがある。

### カナリアと RUM について

`Services with Canaries` が 0 なのは、CloudWatch Synthetics を使っていないため。このプロジェクトは Lambda + EventBridge で外形監視とカナリアを自作していて（`sommelier-canary` / `health-check`）、機能としては足りている。Synthetics に移すと月額が増えるので、いまのところ移す理由がない。

`Services with AppMonitors` は CloudWatch RUM のことで、Application Signals とは別サービス。導入するかは独立した判断になる。

### 表示が実態とずれることがある

サービスの一覧は指定した時間範囲のテレメトリから作られる。計装を外した直後は、外す前のデータが時間ウィンドウに残っているため `INSTRUMENTED` のまま見えることがある。実態は実機で確かめる。

```bash
AWS_PROFILE=sakekasu-builder aws lambda get-function-configuration \
  --function-name dev-sakekasu-ocr-analyzer --region ap-northeast-1 \
  --query '{Layers:Layers,Wrapper:Environment.Variables.AWS_LAMBDA_EXEC_WRAPPER}'
```

一覧と計装状態はこれで見られる。

```bash
AWS_PROFILE=sakekasu-builder aws application-signals list-services \
  --start-time $(( $(date +%s) - 86400 )) --end-time $(date +%s) --region ap-northeast-1 \
  --query 'ServiceSummaries[].{Name:KeyAttributes.Name,Inst:AttributeMaps[?InstrumentationType].InstrumentationType|[0]}' \
  --output table
```

## 計装の代償（実測）

2関数とも、計装の前後を同じ関数で比べた値。

| | OCR（512MB、2026-08-10） | presigned-url（128MB、2026-08-16） |
|---|---|---|
| コールドスタート（計装前） | 638 ms | 438 ms（454 / 410 / 451 の平均） |
| コールドスタート（計装後） | 1241 ms（**+602 ms**） | 1145 ms（**+707 ms**） |
| Max Memory Used（計装前） | 159 MB | 100〜103 MB |
| Max Memory Used（計装後） | 160 MB | **120 MB** |

ウォームな呼び出しは影響を受けない（`presigned-url` で 50〜78 ms のまま）。効くのはコールドスタートで、レイヤーが展開後 9.7MB あるぶん初期化が伸びる。

### メモリは枠が狭いほど効く

OCR（512MB）ではほぼ変化が無かったのに、`presigned-url`（当時 128MB）では 20MB 増えた。枠が狭いと Node のヒープの取り方が変わるため、レイヤーぶんの増分がそのまま見える。

**この 20MB が問題だった。** 128MB に対して残り 8MB では、超えた時点で invocation ごと OOM で落ちる。落ちる先が画像アップロードの入口なので、いちばん困る場所になる。**そのため `presigned-url` は 512MB に上げた**（Issue #86、2026-08-16）。

なおこの 120MB は固定的なオーバーヘッドで、画像の枚数では増えない。URL に署名するだけで、`copyImages` も S3 側でコピーするためバイト列が Lambda を通らない。実測でも4回の invocation がすべて 120MB で揃っていた。青天井ではないが、8MB は薄すぎる。

### メモリを上げるとコールドスタートも戻る

Lambda は割り当てメモリに比例して CPU を配るので、128MB → 512MB で CPU が4倍になり、初期化はおおむねその比で縮む。計装前の 438 ms を下回る見込み。

費用は判断材料に入れなくてよい。GB-秒の単価は上がるが初期化が縮むぶん相殺され、そもそもこの規模（月に数百リクエスト）では月 400,000 GB-秒の無料枠に遠く届かない。

計装した関数が既定のメモリのままになっていないことは `lambda-config.test.ts` で見ている。3つ目を足すときも同じ判断が要るため。

### 測り方

```bash
# 直近のコールドスタートを拾う。REPORT 行の Init Duration がある呼び出しだけ
AWS_PROFILE=sakekasu-builder aws logs filter-log-events \
  --log-group-name /aws/lambda/dev-sakekasu-presigned-url \
  --start-time $(( ($(date +%s) - 86400) * 1000 )) \
  --filter-pattern '"Init Duration"' --region ap-northeast-1 \
  --query 'events[].message' --output text
```

24時間の窓に計装前の値が残っていれば、これ1回で前後が並ぶ。残っていなければ、同じコマンドを**マージ前**に流して控えておく。それも取り忘れたら、CloudWatch Logs Insights で計装が入った時刻をまたいで `Init Duration` を並べる。

## SLO をまだ入れていない理由

Issue #86 には SLO の定義とエラーバジェット消費アラームも挙げてあるが、この変更には含めていない。

SLO はしきい値（可用性 99%、レイテンシー p90 ≤ 15s など）を決めないと作れない。その値は実測を見てから決めるものなので、先に計装だけ入れてデータを溜める。当てずっぽうのしきい値で作ると、鳴りっぱなしか鳴らないかのどちらかになり、作り直すことになる。

データが溜まり始めたのは OCR が 2026-08-10、`presigned-url` が 2026-08-16 から。`presigned-url` のぶんが1〜2週間たまるのは 8月末以降になる。

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

- **起動ラッパーの名前はレイヤーごとに違う。** ランタイムの言語では決まらない。`AWSOpenTelemetryDistroJs`（Application Signals 用）は `/opt/otel-instrument`、`aws-otel-nodejs-amd64-ver-*`（汎用 ADOT）は `/opt/otel-handler`。取り違えると関数が起動しなくなる
- **レイヤーは中身を確かめてから使う。** ARN が実在することは検証にならない。`Content.Location` の署名付き URL を落として、目的のファイルが入っているかを見る

  ```bash
  URL=$(AWS_PROFILE=sakekasu-builder aws lambda get-layer-version-by-arn \
    --arn <レイヤーARN> --region ap-northeast-1 --query 'Content.Location' --output text)
  curl -s "$URL" -o layer.zip && unzip -l layer.zip | grep -E "otel-instrument|otel-handler"
  ```

- **ESM バンドルは通る見込み（実機確認は計装後）。** 対象の関数は esbuild で ESM の単一ファイル（`index.mjs`）にバンドルしている。レイヤーの `otel-instrument` は `/var/task/*.mjs` の有無で ESM を判定し、Node 20 以上なら `--import /opt/wrapper.mjs` を使う。これは `module.register()` による選択的フックで、レイヤー自身のコメントに「バンドルされたアプリコードの ESM ライブバインディングを壊す `--experimental-loader` を避けるため」と書かれている。加えて CDK は `@aws-sdk/*` を external にするため（合成結果で確認済み。バンドルには import 文しか残っていない）、SDK は実行時に読み込まれフックが刺さる。それでも効かなければ対象関数だけ CJS バンドルに変える
- **Bedrock のリクエスト本文はスパンに載らない。** `InvokeModel` のフックは body を `JSON.parse` するが、取り出すのは `max_tokens` / `temperature` / `top_p` などの推論パラメータだけで、`messages`（base64 画像）を属性に入れる箇所は無い。ただし**レイヤーには本文キャプチャの仕組み自体はある**。`AGENT_OBSERVABILITY_ENABLED=true` を設定すると `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` が既定で `true` になり、最大 5MB の画像がスパン属性に載りうる。

  **これは `enableApplicationSignals()` が `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false` を必ず入れることで塞いである。** 以前はこの文書に「入れるときは明示的に false を指定すること」と書いてあるだけで、`AGENT_OBSERVABILITY_ENABLED` を足す人がこの段落を読んでいることが唯一の歯止めになっていた。ソムリエ側の GenAI Observability を広げるときも、こちらを外さない限り本文は載らない
- **Bedrock のフックが毎回 5MB の JSON をパースする。** 属性を取り出すために `JSON.parse(commandInput.body)` が呼び出しごとに走る。セキュリティの問題ではないが遅延要因になる。レイテンシーを見るときはレイヤー読み込みぶんと合わせて見込む
- **コールドスタートが悪化する。** レイヤーは展開後 9.7MB ある。実測で OCR が +602ms、`presigned-url` が +707ms。**メモリの余裕も 20MB ほど削られる**ので、枠が狭い関数では OOM に近づく。3つ目を足すときはメモリを見直すこと（「計装の代償」を参照）
- **レイヤーの ARN にはバージョンが埋まっている**（`AWSOpenTelemetryDistroJs:15`）。上げるときは ARN ごと差し替える。自動で追随する仕組みは入れていないので、たまに新しいバージョンが出ていないかを見る。差し替えるときは中身の展開もやり直すこと。

  ARN は `api-stack.test.ts` に**提供元アカウント（`615299751070`）とバージョンまで込みで**書き写してある。レイヤーはアプリと同じ実行環境でアプリコードより先に動き、実行ロールの認証情報にも環境変数にも届くため、名前の部分一致だけで見ていると提供元の取り違えを緑のまま通してしまう。差し替えるときは実装とテストの両方を直すことになる（片方だけだと落ちる）

  ```bash
  # 存在するバージョンを探す（list-layer-versions はクロスアカウントでは権限が要る）
  AWS_PROFILE=sakekasu-builder aws lambda get-layer-version-by-arn \
    --arn arn:aws:lambda:ap-northeast-1:615299751070:layer:AWSOpenTelemetryDistroJs:16 \
    --region ap-northeast-1 --query 'CreatedDate' --output text
  ```

- **アーキテクチャを x86_64 で明示している。** 既定値の変化でレイヤーと噛み合わなくなるのを防ぐため。`AWSOpenTelemetryDistroJs` は arm64 にも対応しているので、費用を詰めるなら arm64 へ寄せる余地がある
- **リージョンを変えるならレイヤーの ARN も差し替える。** レイヤーは同じリージョンのものしか付けられない
- **AppSync（JS リゾルバー）は Application Signals の対象外。** 必要なら AppSync 側の X-Ray トレーシングを別途有効にする（README の「Issue にしていない小さな宿題」）

## 参考

- [Enable your applications on Lambda](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Application-Signals-Enable-LambdaMain.html)
- [ADOT Lambda Layer ARNs](https://aws-otel.github.io/docs/getting-started/lambda)
- [CloudWatch 料金](https://aws.amazon.com/cloudwatch/pricing)
