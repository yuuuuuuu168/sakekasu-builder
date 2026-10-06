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

監視系（health-check / slack-notifier）は計装しない。監視の監視は既存のアラームで足りていて、増やすとノイズと費用だけが増える。

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
3. **ソムリエのトレースを確認する** — GenAI Observability にソムリエ Runtime のトレースが出るか見る（確認済み。下の「ソムリエのトレース」を参照）
4. **トレースに利用者の識別子が入っていないか確認する**（下記）
5. **1週間後にコストを見る** — Cost Explorer で CloudWatch の増分を確認する（確認済み。下の「費用」を参照）

出てこないときは、まずサービス検出が有効かを疑う（上記の `get-role`）。次に関数の環境変数とレイヤーが実機に入っているかを見る。

```bash
AWS_PROFILE=sakekasu-builder aws lambda get-function-configuration \
  --function-name dev-sakekasu-ocr-analyzer --region ap-northeast-1 \
  --query '{Layers:Layers[].Arn,Wrapper:Environment.Variables.AWS_LAMBDA_EXEC_WRAPPER,Tracing:TracingConfig.Mode}'
```

### ログの保持期間（作業不要だった）

Application Signals と Transaction Search が使うロググループは AWS 側が自動で作る。**AWS が作る時点で 30 日が付いているので、こちらで設定する必要は無かった。** 2026-08-16 の実測。

| ロググループ | 保持 | 蓄積 |
|---|---|---|
| `aws/spans` | 30日 | 3.3 MB |
| `/aws/application-signals/data` | 30日 | 347 KB |

以前ここには「既定の保持期間は無期限なので、出てきたら設定する」と書いてあったが誤り。`lib/log-retention.ts` のコメント（`aws/spans` は AWS が既定で 30 日を付ける）のほうが正しかった。

CDK からは触れない。まだ存在しないものに保持期間は付けられないし、同名で作ろうとすると衝突する。加えてアカウントに1つのロググループなので、Transaction Search 本体と同じくスタックの寿命に紐づけない。

現状の確認はこれで足りる。

```bash
for lg in aws/spans /aws/application-signals/data; do
  AWS_PROFILE=sakekasu-builder aws logs describe-log-groups \
    --log-group-name-prefix "$lg" --region ap-northeast-1 \
    --query 'logGroups[].{Name:logGroupName,Retention:retentionInDays,StoredBytes:storedBytes}'
done
```

X-Ray のトレースそのものは30日で消える（X-Ray 側の固定値で変更できない）。保持期間が効くのは、Transaction Search が Logs 側に送るぶん。

### トレースに利用者の識別子が入っていないか確認する

S3 のキーは `<Cognito の sub>/<種別>/<記録 ID>/<ファイル名>` という形をしている。計装が AWS SDK の呼び出しパラメータをスパンに載せる実装だと、この sub がトレースに残ることになる。sub は利用者ごとに固定の UUID なので、残るなら扱いを決めておきたい。

**載っていないことを実機で確認済み**（`@opentelemetry/instrumentation-aws-sdk` 0.74.0、2026-08-16）。記録されるのはサービス名・操作名・バケット名までで、キーは属性に入らない。

| 操作 | 確認した関数 | 結果 |
|---|---|---|
| `GetObject` | ocr-analyzer | キー無し（2026-08-10） |
| `CopyObject` | presigned-url | キー無し。`CopySource` も入らない |
| `DeleteObject` | presigned-url | キー無し |
| `PutObject` | — | そもそもスパンが出ない。アップロードはブラウザが署名済み URL で直接 S3 へ送るので Lambda を通らない |

`CopyObject` はコピー元のキーを引数（`CopySource`）に持つので唯一の懸念だったが、載っていなかった。スパンに出るのは次の程度。

```
aws.s3.bucket:                   dev-sakekasu-images
aws.remote.resource.identifier:  dev-sakekasu-images
rpc.method:                      CopyObject
```

レイヤーや計装ライブラリを上げたときは、確認し直すこと。

```bash
for op in CopyObject DeleteObject GetObject; do
  echo "=== $op"
  AWS_PROFILE=sakekasu-builder aws logs filter-log-events \
    --log-group-name aws/spans \
    --start-time $(( ($(date +%s) - 3600) * 1000 )) \
    --filter-pattern "\"$op\"" --region ap-northeast-1 \
    --query 'events[].message' --output text | head -c 2000
  echo
done
```

載るようになっていたら、キーの構造を変える（sub をハッシュ化する、階層から外す）か、スパンプロセッサで該当の属性を落とす。

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
| `health-check` / `slack-notifier` | 意図的に対象外 |
| `LogRetention` × 2 / `CustomAWSCDKOpenIdConnectProv` | CDK が裏で作るカスタムリソース。対象外 |

2関数が入ったので「4 instrumented / 6 not」あたりに落ち着く見込み（ソムリエと合わせて4）。反映には時間ウィンドウぶんの遅れがある。

### カナリアと RUM について

`Services with Canaries` が 0 なのは、CloudWatch Synthetics を使っていないため。このプロジェクトは Lambda + EventBridge で外形監視を自作していて（`health-check`）、機能としては足りている。ソムリエとの実会話を見るカナリア（`sommelier-canary`）も自作していたが、共通ログインへ移ったときに動かせなくなり、消した（[shared-login.md](shared-login.md)）。Synthetics に移すと月額が増えるので、いまのところ移す理由がない。

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

| | OCR（512MB） | presigned-url（128MB） | presigned-url（512MB） |
|---|---|---|---|
| コールドスタート（計装前） | 638 ms | 438 ms（454 / 410 / 451 の平均） | — |
| コールドスタート（計装後） | 1241 ms（**+603 ms**） | 1145 ms（**+707 ms**） | 1202 ms（**+764 ms**） |
| Duration（ウォーム） | — | 50 / 74 / 78 ms | **6 ms 前後** |
| Duration（コールド時の1回目） | — | 1070 ms | **254 ms** |
| Max Memory Used（計装前） | 159 MB | 100〜103 MB | — |
| Max Memory Used（計装後） | 160 MB | **120 MB** | 155 MB |

測定日は OCR が 2026-08-10、`presigned-url` が 2026-08-16（128MB は計装直後、512MB はメモリを上げた直後）。

### メモリを上げてもコールドスタートは縮まない

**ここは一度読み違えた。** 「Lambda は割り当てメモリに比例して CPU を配るので、512MB にすれば初期化も4倍近く速くなる」と見込んで `presigned-url` を 512MB にしたが、実測は 1145 ms → 1202 ms で横ばいだった。

レイヤーぶんの増分を3つ並べると、メモリ配分と無関係にほぼ一定になる。

| 関数 | メモリ | レイヤーぶんの増分 |
|---|---|---|
| OCR | 512MB | +603 ms |
| presigned-url | 128MB | +707 ms |
| presigned-url | 512MB | +764 ms |

4倍の差があっても増分が動かないので、**初期化は CPU 律速ではない**。展開後 9.7MB のレイヤーを読み込む I/O が支配的なのか、初期化フェーズの CPU 配分が実行時と違うのかまでは確かめていない。いずれにせよ実務上の結論は同じで、**メモリを上げる理由にコールドスタートを数えないこと。**

### 縮むのは実行時間のほう

同じ変更で、ウォームな呼び出しは 50〜78 ms から 6 ms 前後へ、コールド時の1回目も 1070 ms から 254 ms へ落ちた。こちらは CPU に素直に比例する（計装が入るとスパンの組み立てぶん CPU を使うため、枠が狭いほど効く）。

結果としてコールドパス全体（init + 1回目）は 2215 ms → 1456 ms。狙った経路とは違うが、体感は改善している。

### メモリを上げた本当の理由

**余裕が無かったこと。** OCR（512MB）では計装前後で 159 → 160 MB とほぼ変わらなかったのに、`presigned-url`（当時 128MB）では 100〜103 MB から 120 MB へ 20MB 増えた。枠が狭いと Node のヒープの取り方が変わるため、レイヤーぶんの増分がそのまま見える。

128MB に対して残り 8MB では、超えた時点で invocation ごと OOM で落ちる。落ちる先が画像アップロードの入口なので、いちばん困る場所になる。512MB へ上げた後は 155 MB（30%）に収まっている。

なおこの増分は固定的なオーバーヘッドで、画像の枚数では増えない。URL に署名するだけで、`copyImages` も S3 側でコピーするためバイト列が Lambda を通らない。実測でも複数の invocation が同じ値で揃っていた。青天井ではないが、8MB は薄すぎた。

### 費用

判断材料に入れなくてよい。ただし「初期化が縮むぶん相殺される」わけではない（縮まないので）。内訳は次のとおり。

- ウォームな呼び出しは**安くなる**。メモリが4倍でも実行時間が10倍速いため、GB-秒では 1/3 程度
- コールドスタートは**高くなる**。init が縮まないままメモリだけ4倍なので、GB-秒で 2.6倍

どちらもこの規模（月に数百リクエスト）では月 400,000 GB-秒の無料枠に対して誤差になる。

計装した関数が既定のメモリのままになっていないことは `lambda-config.test.ts` で見ている。3つ目を足すときも同じ判断が要るため。**そのときコールドスタートは 600〜800 ms 増えると見込むこと。メモリで買い戻せない。**

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

## ソムリエのトレース（2026-10-03 確認）

GenAI Observability にソムリエ Runtime のトレースが出ている。サービスとして `sommelier_sommelier.DEFAULT`（`Environment: bedrock-agentcore:default`）が検出されていて、**下流ごとの内訳まで取れている**。

```
Service:                 sommelier_sommelier.DEFAULT
Operation:               POST /invocations
RemoteService:           AWS::BedrockAgentCore
RemoteOperation:         RetrieveMemoryRecords / ListEvents
RemoteResourceType:      AWS::BedrockAgentCore::Memory
RemoteResourceIdentifier: sommelier_preference-MF60B0B2hE
```

Issue #86 が狙っていた「下流依存ごとの遅延・エラーの内訳」は、ソムリエについては計装を足さずに揃っている。AgentCore 側が最初から出しているため。

GenAI 固有のメトリクス（`InputTokens` / `OutputTokens` / `GenAISystem-InputTokens` / `GenAISystem-OutputTokens`）も出る。レイテンシーは日次4〜5件で 1.2〜4.1 秒。

```bash
AWS_PROFILE=verify aws cloudwatch get-metric-statistics --region ap-northeast-1 \
  --namespace ApplicationSignals --metric-name Latency \
  --dimensions Name=Environment,Value=bedrock-agentcore:default \
               Name=Service,Value=sommelier_sommelier.DEFAULT \
  --start-time 2026-09-03T00:00:00Z --end-time 2026-10-03T00:00:00Z \
  --period 86400 --statistics SampleCount Average
```

**メトリクスの名前空間は `ApplicationSignals`（`AWS/` が付かない）。** SLO 由来の `AttainmentRate` などが入っている `AWS/ApplicationSignals` とは別物で、サービスのゴールデンメトリクスはこちらにある。取り違えると空の結果が返るだけなので、間違いに気づきにくい。

## SLO

OCR と `presigned-url` に2つずつ定義してある（`monitoring-stack.ts` の `SLO_TARGETS`）。

| SLO | 目標 | 評価期間 |
|---|---|---|
| `dev-sakekasu-ocr-analyzer-availability` | 成功率 90% | 30日 rolling |
| `dev-sakekasu-ocr-analyzer-latency` | 90% が 15 秒未満 | 30日 rolling |
| `dev-sakekasu-presigned-url-availability` | 成功率 90% | 30日 rolling |
| `dev-sakekasu-presigned-url-latency` | 90% が 2 秒未満 | 30日 rolling |

`presigned-url` は計装が 2026-08-16 に入ったあと、材料が溜まるのを待って 2026-10-03 に追加した。

対象を増やすときは `SLO_TARGETS` に1行足す。**`idPrefix` は CloudFormation の論理 ID に入るので、既存のものは変えない。** 変えると SLO が作り直されて30日ぶんの達成率が消える。デプロイは成功するので、気づくのは「鳴るべきときに鳴らなかった」あとになる。

### なぜ既存のアラームがあるのに要るか

`dev-sakekasu-ocr-errors` は「15分で3件以上」で鳴る。まとまって落ちたときには効くが、**ぽつぽつ失敗するのは素通りする**。実際 Issue #115 は24時間で12回中3回の失敗（エラー率 25%）で、このアラームは一度も鳴っていない。30日の budget で見ると、そういう緩やかな失敗が数字に出る。

### しきい値の根拠

利用者が本人だけで実績は日に数回なので、厳しくしても鳴りっぱなしになるだけ。90% に置いた。30日で 90 リクエスト程度、失敗 9 回までが budget の中に入る。

レイテンシーのしきい値は実測から。2026-08-11〜16 の日次はこうなっている。

| 日 | 件数 | p50 | p90 | p99 |
|---|---|---|---|---|
| 8/11 | 3 | 7137 | 7147 | 7150 |
| 8/12 | 3 | 4619 | 4764 | 4797 |
| 8/16 | 4 | 4830 | 8006 | 8146 |

**単位はミリ秒。** `get-metric-statistics` の応答が `Unit: Milliseconds` を返し、生値も4桁で出る（秒に直すと 4.6〜8.1 秒）。SLO の `MetricThreshold: 15000` はこの単位に合わせた 15 秒で、**秒だと思って 15 を入れると 15 ミリ秒になり達成率が 0% に張り付く**。逆にミリ秒の値を秒として読むと「15000 秒＝約4時間」と誤読される（PR #161 のレビューで実際に起きた）。数字を書き換えるときは単位を確認すること。

所要時間の大半は Bedrock なので画像の大きさで振れる。8 秒台の実測に対して 10 秒だと余裕が 2 秒しかなく揺れで鳴るため、倍近い余裕を取った。ここを割るのは「いつもより明らかに遅い」ときだけでよい。

#### presigned-url は 2 秒

2026-10-03 の実測（30日、172リクエスト）。

| 指標 | 値 |
|---|---|
| 件数 | 172 |
| 日次 p99 | 476〜1,030ms |
| 最大 | 1,041ms |
| Error / Fault / Throttle | すべて 0 |

最大 1,041ms に対して約2倍の余裕を取って 2,000ms にした。

**コールドスタートの分を上積みしていないのは、この指標に乗らないため。** Application Signals の `Latency`（最大 1,041ms）と Lambda の `Duration`（最大 1,085ms）はほぼ一致し、どちらも Init Duration を含まない。計装込みのコールドスタートは 1.1〜1.2 秒あるが、そこは別の話になる。

可用性 SLO も付けてある。実測はエラー 0 件だが、既存の `dev-sakekasu-lambda-errors-presignedurlfunction` は**15分で5件以上**でしか鳴らないので、ぽつぽつ失敗する形は素通りする。OCR で SLO を足した理由と同じ穴が空いている。

ただし 172 リクエスト / 30日という規模では、90% を割るのに約17件の失敗が要る。**単発や数件の失敗を捕まえるものではない。** そこは既存のエラーアラーム側の仕事で、SLO が見ているのは「じわじわ壊れ続けている」状態のほう。

### request-based にしている理由

period-based は「期間ごとに good / bad を判定して、good な期間の割合」を見る。日に数回しか呼ばれないと、ほとんどの期間がデータ無しになって判定が成り立たない。request-based は「リクエストの成功割合」を直接数えるので、疎なトラフィックでも意味のある値になる。

同じ理由でバーンレートの参照窓は1日（1440分）だけにしてある。1時間窓はほとんどが空になる。

### SLO を割ったときのアラーム

`dev-sakekasu-ocr-slo-availability` と `dev-sakekasu-ocr-slo-latency` の2つ。既存の SNS（`dev-sakekasu-alerts`）に繋いである。monitoring スタック側に置いているのは、ApiStack に置くと通知先の SNS を参照して循環参照になるため。

**バーンレートではなく達成率（`AttainmentRate`）を見ている。** バーンレートは「エラー率 ÷ (100% − 目標)」なので、日に数回の規模だと1回の失敗で 3.3 まで跳ねる。必ず鳴る形は「30日で9回まで許容する」という budget の設計と噛み合わない。達成率なら30日の成功率そのものなので、失敗が積み上がったときだけ 90 を割る。

しきい値は SLO の目標と同じ定数（`SLO_ATTAINMENT_GOAL`）から取っている。別々に書くと、片方だけ動かしたときに「SLO は未達なのにアラームは鳴らない」が黙って生まれる。

欠損時は状態を保つ（`missing`）。このリポジトリのアラームは既定で「欠損＝異常なし」だが、30日 rolling の値が出なくなったときに復旧と判定されると困るので、カナリアと同じ扱いにしてある（`monitoring-stack.test.ts` の例外一覧に理由付きで載せてある）。

#### 名前空間が2つある

**`AWS/ApplicationSignals` と `AWS/AppSignals` の両方に、同じメトリクス名・同じディメンションで同じ値が出る**（2026-08-17 実測。どちらも `84.5070422` を返した）。別名と思われる。正式名のほうを使っている。

出ているメトリクスは以下。ディメンションは `SloName` のみで、`BurnRate` だけ `BurnRateWindowMinutes`（SLO 側で指定した 1440）が付く。

```
AttainmentRate / BurnRate / BreachedCount
TotalRequestCount / TotalRequestCountPerMinute / BadRequestCountPerMinute
```

`SloName` は `CfnServiceLevelObjective` の `name` と一致していないといけない。ずれるとアラームは `INSUFFICIENT_DATA` のまま居座り、「監視が入っている」ように見えて何も鳴らない。SLO 名の組み立ては `monitoring-stack.ts` の中で1か所に閉じてある。

```bash
AWS_PROFILE=sakekasu-builder aws cloudwatch list-metrics \
  --namespace AWS/ApplicationSignals --region ap-northeast-1 --output json
```

### 導入時点の達成率と、その調査結果（2026-08-17）

SLO を作った直後の可用性は **84.51%**（`60/71`）で、すでに目標を割っていた。11件すべての中身を追った結果、**現行のコードに起因する失敗は1件も無かった**。

| 日時（UTC） | 件数 | 原因 |
|---|---|---|
| 08-03 11:09 / 08-08 14:28 ×5 / 08-09 07:57 ×3 | 9 | Issue #115（Bedrock の 5MB 上限は base64 後の値）。PR #117 で修正済み |
| 08-10 03:52 / 04:50 | 2 | `event.arguments` が無い直接 invoke。計装の動作確認中の手動実行で、実利用の失敗ではない |

#115 の修正（2026-08-10 02:04Z）以降、この失敗は一度も起きていない。08-11・08-12・08-16 のエラーはいずれも 0。

### 赤いまま置く期間を作らない（2026-08〜09 の教訓）

SLO を入れた直後、導入前に起きていた失敗が30日窓に残っているせいで可用性アラームが赤いままになった。当時この文書には「09-09 ごろに自然に戻る。Slack に通知が来ても、この期間は既知として扱ってよい」と書いていた。

**これは失敗だった。** 赤が続いている間に別の障害（下の 08-24 の項）が起き、アラームは既に ALARM なので状態遷移が無く、Slack にも出ないまま埋もれた。「既知だから流す」運用は、その窓の中で起きた本物を一緒に捨てる。

赤いまま放置する期間をどうしても作るなら、**期限を切って、明けたら実測を取り直すこと**。アラームの状態ではなく、SLO の達成率そのものを定期的に見るほうが確実。

実際には 09-23 15:47 UTC に OK へ戻った（08-24 の78件が窓から抜けたタイミング）。想定していた 09-09 ではなく、2週間遅れている。**窓が明ける日付は、途中で新しい失敗が入れば後ろにずれる。** 日付を決め打ちにして待つ運用が成り立たないのはこのためでもある。

### 除外ウィンドウでは消せない

起きてしまった失敗を SLO の評価から外せないか試したが、デプロイが次のエラーで失敗した（PR #166、2026-08-17）。

```
Invalid start time Mon Aug 03 00:00:00 UTC 2026:
start time must not be in the past
```

書式（ISO 8601）は正しく解釈されていて、拒否されたのは**開始時刻が過去である**こと。除外ウィンドウ（`exclusionWindows`）は計画メンテナンスのように**これから来る期間**を外すための機能で、起きてしまった事象を後から除外する用途には使えない。

CloudFormation は `UPDATE_ROLLBACK_COMPLETE` で戻るため、失敗しても SLO とアラームは無事。ただし修正するまで以降のデプロイが毎回落ちるので、気づいたらすぐ戻すこと。

### 一括読み取りが古い写真で 78 回失敗した（2026-08-24・修正済み）

09-15 に SLO 可用性アラームが **54.39%**（`93/171`）で鳴った。窓（08-16〜09-15）の失敗 78 件は**すべて 08-24 14:50〜15:05 UTC の15分に固まっていて、文言も全部同じ**だった。

```
ERROR [OCR] image too large for Bedrock: index=0 base64=5340208 limit=5242880
ERROR Invoke Error {"errorMessage":"Image too large for OCR"}
```

原因は同日 14:06 UTC に入れた**詳細スペックの一括読み取り**（PR #199）。登録済みの S3 キーをそのまま `analyzeSakeLabel` に渡す作りで、150 件を順に投げて 78 件が上限で落ちた。

**古い写真はフロントの圧縮を通っていない。** `imageCompressor.ts` の上限は Bedrock の 5MB から逆算した 3.75MB だが、これは #115 の修正（PR #117、08-10）で入った値で、それ以前に登録された写真は 5MB 近いまま S3 に残っている。base64 にすると 4/3 倍になり、実測は 5.3〜6.7MB でいずれも上限超えだった。`assertImagesFitBedrockLimit()` はこれを正しく弾いている。**Lambda は期待どおりに動いていて、壊れていたのは呼ぶ側**。

#### 同じ失敗を毎回繰り返す作りだった

`requestLabelSpecs()` は失敗を「呼び出しの失敗（やり直せば変わりうる）」と「読めたが中身が空（控える）」の2つにしか分けていなかった。大きすぎる画像は前者に落ちるため控えられず、**バナーを押すたびに同じ 78 件を投げ直す**状態だった。1回で SLO は 54% まで落ちる。

`skipStorage.ts` の先頭にある「64件を2周して1件も増えないまま Bedrock を128回呼んだ」と同じ形。あちらは「読めなかった」を控えることで塞いだが、**恒久的な失敗がその手前をすり抜けていた**。

失敗を3つに分けて直した（`LabelSpecsOutcome`）。

| 分類 | 例 | 扱い |
|---|---|---|
| `read` | 解析が通った（中身が空でも） | 既存どおり。空なら版つきの控えへ |
| `retryable` | 通信、スロットリング、`Failed to retrieve image from storage` | 控えない |
| `permanent` | `Image too large for OCR` / `Invalid image content` | **版を持たない控え**へ入れ、読み直しからも外す |

`permanent` の控えだけ `version` を切らない（`spec-unreadable-image`）。`EXTRACTION_VERSION` はモデルやプロンプトを変えたときに上げる版で、上げれば控えが読み捨てられて対象に戻る。だが画像の大きさはモデルを替えても変わらないので、版に紐づけると**版を上げるたびに 78 件を一斉に投げ直す**。同じ理由で読み直し（reread）からも外す。

判断がつかない失敗は `retryable` に倒してある。取りこぼしても次回また試すだけだが、誤って `permanent` にすると読めるはずの記録が二度と対象に入らない。

文言は Lambda が投げる文字列をフロントが見ている。ずれても壊れはせず、`retryable` に倒れて「毎回投げ直す」元の挙動に戻るだけなので、`index.ts` の両方の関数に注意書きを置いてある。

#### 撮り直さない限りスペックは入らない

この 78 件は対象から外れるだけで、**読めるようになるわけではない**。写真を撮り直して差し替えれば控えの鍵（記録ID + 画像キー）が変わり、自動でまた対象に入る。

根本から直すなら Lambda 側で上限超えを縮小してから Bedrock に渡すことになるが、`sharp` のようなネイティブ依存を Lambda に持ち込む話になるので、必要になってから判断する。

#### この15分は SLO アラームからは見えなかった

08-17 から 09-10 まで、SLO 可用性アラームは #115 の履歴で**すでに赤かった**。08-24 の 78 件はその赤の中に埋もれ、状態遷移が起きないので Slack にも何も出ない。「直すものが無いのに赤が続くと監視そのものを損なう」と PR #166 のコミットに書いたとおりのことが、その1週間後に起きている。

**気づけたのは既存の `ocr-errors`（15分で3件）のほう**で、08-24 14:51 UTC に ALARM → 15:14 UTC に OK と正しく遷移している。SNS の修正（08-17）より後なので Slack にも届いていた。粗いしきい値のアラームが、SLO を塞いだ穴を埋めた形になる。

今回 09-15 に表に出たのは、08-26 以降トラフィックが止まって `AttainmentRate` の出力自体が途切れ（09-10 に `INSUFFICIENT_DATA` へ遷移）、09-15 の1回の呼び出しでメトリクスが復活したため。復活した値が窓に残る 08-24 を映していた。

**08-24 が窓から抜ける 09-24 ごろに、アラームは自然に OK へ戻る**。それまでに追加の失敗が無ければ、窓は `3/3` で 100% になる。

### アラームが鳴っても Slack に届かなかった（2026-08-17・修正済み）

SLO アラームが初めて ALARM へ遷移したとき、Slack には何も来なかった。**原因は Application Signals とは無関係で、通知経路そのものが壊れていた。** SNS トピックポリシーが CloudWatch からの `sns:Publish` を拒否しており、このスタックのアラーム全部が無音だった。

ここで表に出たというだけなので、詳細はこの文書ではなく通知経路の実装側に置いてある。経緯・実害・壊れているかの見分け方は `infra/lib/monitoring-stack.ts` の `AlertTopic` 直後のコメントを参照。

### 失敗の中身を調べる

失敗ごとに `ERROR Invoke Error {"errorMessage":"..."}` という1行の要約が出る。これを拾えば、スタックトレース抜きで一覧できる。

```bash
AWS_PROFILE=sakekasu-builder aws logs filter-log-events \
  --log-group-name /aws/lambda/dev-sakekasu-ocr-analyzer \
  --start-time $(( ($(date +%s) - 86400 * 30) * 1000 )) \
  --filter-pattern '"Invoke Error"' --region ap-northeast-1 \
  --query 'events[].[timestamp,message]' --output text | cut -c1-170
```

**ハンドラに到達しない失敗（起動時のエラー）はこれに出ない。** 計装のレイヤーを差し替えた直後などは、こちらも見る。

```bash
AWS_PROFILE=sakekasu-builder aws logs filter-log-events \
  --log-group-name /aws/lambda/dev-sakekasu-ocr-analyzer \
  --start-time $(( ($(date +%s) - 86400 * 2) * 1000 )) \
  --filter-pattern '?"INIT_REPORT" ?"Runtime.ExitError" ?"does not exist"' \
  --region ap-northeast-1 --query 'events[].[timestamp,message]' --output text
```

Lambda のエラー数と突き合わせると、ログで説明できていない失敗が残っていないか分かる。

```bash
AWS_PROFILE=sakekasu-builder aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda --metric-name Errors \
  --dimensions Name=FunctionName,Value=dev-sakekasu-ocr-analyzer \
  --start-time "$(date -u -v-30d +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --period 86400 --statistics Sum --region ap-northeast-1 \
  --query 'sort_by(Datapoints,&Timestamp)[].[Timestamp,Sum]' --output text
```

### 実測を取り直すコマンド

しきい値を見直すときはこれで分布を取る。

```bash
AWS_PROFILE=sakekasu-builder aws cloudwatch get-metric-statistics \
  --namespace ApplicationSignals --metric-name Latency \
  --dimensions Name=Service,Value=dev-sakekasu-ocr-analyzer \
               Name=Environment,Value=lambda:default \
  --start-time "$(date -u -v-30d +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --period 86400 --extended-statistics p50 p90 p99 --statistics SampleCount \
  --region ap-northeast-1 --output table
```

## 費用

### 実測（2026-10-03、アカウント <アプリのアカウント ID>）

導入前（6〜7月）と導入後を並べたもの。金額は `UnblendedCost` の `Usage` レコードのみで、クレジットによる相殺前の実使用額。

| 月 | CloudWatch 合計 | うち Application Signals | うちアラーム | X-Ray スパン |
|---|---|---|---|---|
| 2026-06 | $0 | $0 | $0（アラーム1件） | $0 |
| 2026-07 | $0 | $0 | $0（アラーム1件） | $0 |
| 2026-08 | $1.25 | $0.14（93,518） | $1.10（20件） | $0.0055（7,354） |
| 2026-09 | $1.84 | $0.22（149,442） | $1.61（25件） | $0.0015（1,954） |

**Application Signals 自体は月 $0.22（約33円）で、見込み（月数十円〜数百円）の下限に収まっている。** 計装のコストは問題にならない。

むしろ CloudWatch の請求を押し上げているのは**アラームのほう**で、9月は $1.84 中 $1.61（87%）を占める。無料枠が10件なので、アラームを増やすほうが費用に効く。APM を入れると高くつく、という事前の警戒は的を外していた。

なお現時点では全額がクレジットで相殺されており、請求額としてはゼロになっている（`RECORD_TYPE` を見ると `Usage` $1.84 に対して `Credit` -$1.84）。**クレジットが切れたらこの額がそのまま出る**ので、ゼロだと思って放置しない。

参考として、アカウント全体は9月 $1.32（うち Bedrock が $1.20）。CloudWatch はクレジットで消えているため合計に乗っていない。

```bash
AWS_PROFILE=verify-org aws ce get-cost-and-usage --region us-east-1 \
  --time-period Start=2026-09-01,End=2026-10-01 --granularity MONTHLY \
  --metrics UnblendedCost UsageQuantity --group-by Type=DIMENSION,Key=USAGE_TYPE \
  --filter '{"And":[{"Dimensions":{"Key":"LINKED_ACCOUNT","Values":["<アプリのアカウント ID>"]}},{"Dimensions":{"Key":"SERVICE","Values":["AmazonCloudWatch"]}},{"Dimensions":{"Key":"RECORD_TYPE","Values":["Usage"]}}]}'
```

費用は管理アカウント側にあるので `verify-org` プロファイルを使う。`LINKED_ACCOUNT` で絞らないと管理アカウント自身の分しか見えず、ゼロが並ぶ。

### 単価

- Transaction Search: 取り込み $0.35/GB + インデックス済みスパン $0.75/100万（先頭 1% は無料）

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
- **コールドスタートが悪化する。** レイヤーは展開後 9.7MB ある。実測で 600〜800ms 増える。**メモリを上げても縮まない**（実測済み。初期化は CPU 律速ではない）。あわせてメモリの余裕も 20MB ほど削られるので、枠が狭い関数では OOM に近づく。3つ目を足すときはメモリを見直すこと（「計装の代償」を参照）
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
