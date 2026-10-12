# AWS DevOps Agent 連携（#67）

アラームが鳴ってから人間が調べ始めるまでの時間をなくすための仕組み。CloudWatch アラームが発報したら、そのまま AWS DevOps Agent に調査を依頼する。エージェントはテレメトリ・ログ・デプロイ履歴を突き合わせて根本原因と緩和策をまとめ、専用の Slack チャンネルに投稿する。

投稿を読んだ側から追加で頼みたくなったぶんは、双方向用のプライベートチャンネルで受ける。メンションで調査を始めたり、経過を聞いたりできる（[Slack の双方向通信](#slack-の双方向通信)）。

```
4 アプリの CloudWatch アラーム ─┐
共通基盤の外形監視 ─────────────┴→ SNS（sakekasu-integrated-alerts）┬→ Slack 通知 Lambda → Slack（#sakekasu-builder-alarm）
                                                                   │
                                                                   └→ 転送 Lambda → DevOps Agent Webhook
                                                                                         ↓
                                                                      自動調査 → Slack（双方向用のプライベートチャンネル）

人 ⇄ Slack（双方向用のプライベートチャンネル）⇄ DevOps Agent
     メンションで調査の開始・経過の照会・追加の指示
```

既存の Slack 通知はそのまま残る。転送 Lambda は同じトピックをもう1つの購読者として横から受け取るだけなので、エージェントが止まってもアラート自体は届く。

**トピックと転送 Lambda は共通基盤（sakekasu-integrated_environment）にある（2026-10 に移した）。**
以前は転送 Lambda がこのリポジトリにあり、builder のトピック（`dev-sakekasu-alerts`）だけを購読していた。
他の 3 アプリのアラームは Slack に届くだけで調査に回っていなかったので、共通トピックの側へ移し、builder のアラームも
共通トピックへ送るようにした。転送の作り（調査に回す条件、優先度、HMAC、送り先の制限）と設定の登録手順は、
共通基盤の `docs/monitoring.md` の「DevOps Agent への転送」にある。

## アカウント構成

| 役割 | アカウント | プロファイル |
|------|-----------|-------------|
| プライマリ（Agent Space を置く） | `<運用アカウント ID>` | `ops-tooling` |
| セカンダリ（調査対象＝アプリ本体） | `<アプリのアカウント ID>` | `sakekasu-builder` |

Agent Space は運用ツール専用のメンバーアカウント `ops-tooling` に集約する。DevOps Agent は Slack・GitHub・Webhook という外部との接点を持つワークロードで、Organization の管理アカウントは唯一 SCP の制約を受けない場所にあたるため、事故を組織のガードレールで止められる側に置く。

調査対象はアプリ本体のアカウントなので、そちら側にクロスアカウントロールを置き、DevOps Agent のサービスプリンシパル（`aidevops.amazonaws.com`）から直接引き受けさせる。

リージョンは `ap-northeast-1`。

## リポジトリに入っているもの

コンソール側（Agent Space・Slack・GitHub 連携）は手作業で、アプリ本体アカウント側は CDK で作る。スタックは `sakekasu-dev-devops-agent`（`infra/lib/devops-agent-stack.ts`）で、中身は調査用のクロスアカウントロールだけ。転送 Lambda は共通基盤へ移した（下の「アラーム転送 Lambda」）。

### 調査用のクロスアカウントロール

`sakekasu-dev-devops-agent-monitoring`。読み取り専用の管理ポリシー `AIDevOpsAgentAccessPolicy` だけを持ち、これに加えて Resource Explorer のサービスリンクロール作成だけを許可する。アクション実行用（Operator）のロールは作っていない。

名前だけ他のリソースと向きが違う（`dev-sakekasu-` ではなく `sakekasu-dev-`）。cdkd のデプロイロールが `role/sakekasu-*` にしか `iam:CreateRole` を持っておらず、`dev-` 始まりだと作れないため。スタック名 `sakekasu-dev-devops-agent` には揃っている。

信頼条件は `aws:SourceAccount`（プライマリのアカウント ID）と `aws:SourceArn`（Agent Space の ARN）の両方で絞る。混乱した代理人（confused deputy）を防ぐための条件で、AWS のドキュメントもこの形を推奨している。

### アラーム転送 Lambda（共通基盤へ移した）

転送 Lambda はいま共通基盤（sakekasu-integrated_environment）にあり、共通トピックを購読して DevOps Agent の Webhook に調査依頼を投げる。
調査に回す条件や優先度、認証などの作りは、共通基盤の `docs/monitoring.md` の「DevOps Agent への転送」にある。

## セットアップ手順

Agent Space の ARN と Webhook の鍵が決まらないと CDK 側が意味を持たないため、コンソール作業が先。

### 1. Agent Space を作る（プライマリ）

DevOps Agent のコンソールに `ops-tooling` で入り、`ap-northeast-1` で Agent Space を作る。作成後、ARN（`arn:aws:aidevops:ap-northeast-1:<運用アカウント ID>:agentspace/xxxxxxxx`）を控える。

Security Agent の Agent Space とは分ける。調査対象も通知先チャンネルも別で、混ぜると Slack の投稿がどちらのものか分からなくなる。

### 2. Slack を繋ぐ

アカウントレベルで Slack を Capability Provider として登録し、Agent Space にチャンネル ID を紐付ける。紐付け先は双方向用のプライベートチャンネルで、アラーム本体が流れる `#sakekasu-builder-alarm` とは分ける。調査の経過報告が細かく量も多いため、混ぜるとアラートが流れていく。

認可のときに Enterprise Grid を選ばない。ワークスペース単位でインストールする。またインストールした Slack アプリはアンインストールしない。再インストールできなくなる可能性があると公式に注意書きがある。

プライベートチャンネルに投げるなら、東京リージョンのアプリを `/invite @AWS DevOps Agent - AP (Tokyo)` で招待しておく。アプリはリージョンごとに別物で、名前の後ろのリージョン表記まで一致していないと紐付かない。入力中に候補が出るので、そこから選ぶのが確実。

ここまでは一方向の通知。Slack からエージェントに話しかける側は [Slack の双方向通信](#slack-の双方向通信) にまとめてある。

### 3. GitHub を繋ぐ

`yuuuuuuu168/sakekasu-builder` を接続する。デプロイとコミットの履歴が調査に入るため、「直前のマージで壊れた」型の障害で効く。

### 4. Webhook を発行する

Agent Space の Capabilities タブから Webhook を作る。認証方式は HMAC を選ぶ（転送 Lambda がその前提で署名している）。表示される URL と署名鍵はこの1回しか見られないので、その場で控える。

### 5. Webhook の設定を登録する

URL と鍵の登録先と手順は、共通基盤の `docs/monitoring.md` の「設定を登録する」にある。

### 6. デプロイする

`agentSpaceArn` があるときだけスタックが合成される。ARN は運用ツール用アカウントの ID を含むので、公開リポジトリの `infra/cdk.json` には書かない。リポジトリの **Settings → Secrets and variables → Actions** に secret `AGENT_SPACE_ARN` として入れておけば、main にマージしたときに GitHub Actions が環境変数で `bin/app.ts` に渡し、cdkd が作る（`deploy.yml`）。

- `deploy.yml` は secret が無いと合成の前で止まる。無いまま合成すると、このスタックだけ黙って更新されなくなるため
- `cdk-diff.yml` は secret があれば同じく渡す。フォークからの PR では secret が渡らないので、このスタックを除いた差分になる
- 運用ツール用アカウントの ID は、ログでは `::add-mask::` で、PR コメントに貼る diff では置き換えで伏せる

手元で合成するときは `-c agentSpaceArn=...` か環境変数 `AGENT_SPACE_ARN` で渡す。

**手元から `npx cdk deploy` を打たない。** cdkd への移行で CloudFormation のスタックは削除されていて、リソースだけが残っている。その状態で `cdk deploy` を打つと、依存する auth / api / monitoring をゼロから作り直そうとして既存リソースと名前がぶつかる（[docs/cdkd-migration.md](cdkd-migration.md)）。計画を先に見たいときは PR の `cdk-diff` を読む。`infra/**` を触る PR では自動で走る。

### 7. セカンダリアカウントを Agent Space に登録する

コンソールの Capabilities タブ → Cloud → Secondary sources → Add から、調査用ロールを登録する。ウィザードはロールを自分で作らせようとするが、ここでは CDK が作ったものを渡す。

```
arn:aws:iam::<アプリのアカウント ID>:role/sakekasu-dev-devops-agent-monitoring
```

cdkd は CloudFormation を通らないのでスタックの出力が無い。ロール名は固定なので ARN はこの形になる。

リソース検出に設定項目は無い。**自動で走る。** 経路は2つある。

- **CloudFormation スタック** — スタックとその中のリソースを列挙する
- **Resource Explorer** — スタックに属さないリソースは、**タグの付いているもの**がここから拾われる

このリポジトリは cdkd への移行で CloudFormation のスタックが消えているので、**使えるのは後者だけ**。タグを付けてあるのはこのためで、コンソールにタグを指定する欄があるわけではない。タグが付いていること自体が検出の条件になる（下の「タグの付け方」）。

以前この手順には CloudFormation スタック3つ（`sakekasu-dev-auth` / `-api` / `-monitoring`）を並べていた。そのスタックは消えたので、スタック指定は使えない。

#### Resource Explorer が要る

セカンダリアカウントで Resource Explorer が有効でないと、スタックに属さないリソースは1つも出てこない。確認はこれ。

```sh
aws resource-explorer-2 list-indexes --profile verify --region ap-northeast-1
```

`<アプリのアカウント ID>` の ap-northeast-1 にはインデックスがあって `ACTIVE`、既定ビューは `tags` を含みフィルタも空。ただし種別は `LOCAL` で、アカウント内に `AGGREGATOR` は無い（2026-10-04 時点）。

#### タグの付け方

タグは CDK からではなく、Resource Groups Tagging API で直接付けてある（2026-10-04、55リソース）。CDK の `Tags.of` で付ける道は一度試して取り下げた。cdkd が取り込み済みリソースを改名してしまうのと、ロググループへのタグ付けが通らないため（[docs/cdkd-migration.md](cdkd-migration.md) の「取り込み済みリソースへの初回更新は改名になる」）。

合成テンプレートに `Tags` が無いので、cdkd はこのタグを管理対象外として素通りする。デプロイで消えることはない（`cdkd diff` が差分を出さないことを確認済み）。

裏を返すと、**リソースを足してもタグは自動では付かない**。監視対象を増やしたら付け直す。
下のスクリプトは `dev-sakekasu-` の前方一致で集めるので、増えた分も含めてそのまま流せばよい。

```sh
PROFILE=sakekasu-builder
REGION=ap-northeast-1
ACCOUNT=<アプリのアカウント ID>
API_ID='<API ID>'

{
  aws lambda list-functions --profile $PROFILE --region $REGION \
    --query "Functions[?starts_with(FunctionName,'dev-sakekasu-')].FunctionArn" --output text
  aws cloudwatch describe-alarms --profile $PROFILE --region $REGION \
    --alarm-name-prefix dev-sakekasu- --query 'MetricAlarms[].AlarmArn' --output text
  aws sns list-topics --profile $PROFILE --region $REGION \
    --query "Topics[?contains(TopicArn,'dev-sakekasu-')].TopicArn" --output text
  aws logs describe-log-groups --profile $PROFILE --region $REGION \
    --log-group-name-prefix /aws/lambda/dev-sakekasu- --query 'logGroups[].arn' --output text
  aws events list-rules --profile $PROFILE --region $REGION \
    --name-prefix dev-sakekasu- --query 'Rules[].Arn' --output text
  aws resourcegroupstaggingapi get-resources --profile $PROFILE --region $REGION \
    --resource-type-filters application-signals \
    --query "ResourceTagMappingList[?contains(ResourceARN,'dev-sakekasu-')].ResourceARN" --output text
  echo "arn:aws:dynamodb:$REGION:$ACCOUNT:table/dev-sakekasu-purchase-records"
  echo "arn:aws:dynamodb:$REGION:$ACCOUNT:table/dev-sakekasu-drinking-records"
  echo "arn:aws:s3:::dev-sakekasu-images"
  echo "arn:aws:appsync:$REGION:$ACCOUNT:apis/$API_ID"
} | tr '\t' '\n' | sed 's/:\*$//' | grep '^arn:' | grep -v learning | sort -u > /tmp/arns.txt

rm -f /tmp/part-*
split -l 20 /tmp/arns.txt /tmp/part-
for f in /tmp/part-*; do
  aws resourcegroupstaggingapi tag-resources --profile $PROFILE --region $REGION \
    --resource-arn-list $(cat $f) --tags Project=sakekasu-builder,Env=dev
done
```

`grep -v learning` を入れているのは、同じアカウントに住む learning のテーブルが `dev-sakekasu-learning-progress` という名前で、素朴な前方一致に引っかかるため。付与の API は失敗しても終了コード 0 を返し、`FailedResourcesMap` に中身を入れる。空の `{}` であることを確かめる。

トポロジにリソースが出てこないときは、セカンダリロールに `AIDevOpsAgentAccessPolicy` が付いているかを最初に疑う。コンソールの検証がチェックマークを出していても、ポリシーが外れていることがある。

次に疑うのは Resource Explorer（上の「Resource Explorer が要る」）。スタックの無いこのアカウントでは、ここが止まると検出そのものが成立しない。

### 8. 動作を確認する

転送の疎通確認は共通基盤の `docs/monitoring.md` の「動作を確かめる」にある。

**同じ識別子でなくても、内容が近ければ進行中の調査に合流する。** 2026-10-04 に `-2` を付けた
2本目を流したところ、新しい調査は立たず Slack にも何も出なかった。API で見ると
`LINKED` になっていた。

```
<タスク ID>  CloudWatch アラーム: TEST-devops-agent-20261004    IN_PROGRESS
<タスク ID>  CloudWatch アラーム: TEST-devops-agent-20261004-2  LINKED
```

捨てられたのではなく、既存の調査に紐付いている。進行中の調査がある状態でテストを流すときは、
Slack に何も出なくても失敗とは限らない。確認はこれ。

```sh
aws devops-agent list-backlog-tasks \
  --agent-space-id <Agent Space ID> \
  --profile verify-ops --region ap-northeast-1
```

#### セカンダリのリソースが見えているかを確かめる

双方向のチャンネルで直接訊く。これが一番早い。

```
@AWS DevOps Agent - AP (Tokyo) <アプリのアカウント ID> のアカウントで見えているリソースを教えて
```

タグはトポロジを組み立てる材料であって、エージェントが読める範囲の制限ではない。読める範囲はロールのポリシーで絞る。

## Slack の双方向通信

一方向の通知だけだと、調査結果を読んで「ではこのログをもう少し見たい」と思った時点で Web アプリに移ることになる。双方向にするとその往復が消える。メンションで調査を始め、経過を聞き、結果に追加の指示を出すところまで Slack の中で終わる。やり取りは元メッセージのスレッドに積まれるので、振り返りのときに誰が何を判断したかがそのまま残る。

### チャンネルの持ち方

双方向はプライベートチャンネルでしか有効にできない。パブリックチャンネルに紐付けた関連付けは一方向通知のままになる。

| チャンネル | 用途 | 向き |
|-----------|------|------|
| `#sakekasu-builder-alarm`（パブリック） | Slack 通知 Lambda が投げるアラーム本体 | 一方向 |
| 双方向用のプライベートチャンネル（2026-10-04 新設） | エージェントとの会話 | 双方向 |

アラームチャンネルを双方向に作り替えず別に足したのは、会話を始めたい人だけをメンバーにしたいため。
アラームは広く見せておきたいので、パブリックのまま残す。

**自動調査の投稿は双方向用のプライベートチャンネルだけに出る**（2026-10-04 にテストアラームで確認）。
Agent Space に紐付いている Slack の関連付けは1つで、投稿先はそのチャンネル1つだけ。
`#sakekasu-builder-alarm` に流れるのは SNS → Slack 通知 Lambda の別系統なので、二重投稿は起きない。

```sh
aws devops-agent list-associations \
  --agent-space-id <Agent Space ID> \
  --profile verify-ops --region ap-northeast-1
```

### 手順

Slack ワークスペースのアカウントレベル登録は済んでいる前提（手順2）。追加で要るのは、DevOps Agent のコンソールから IAM ロールを作れる権限。

1. Slack でプライベートチャンネルを作る。メンバーは運用に関わる人だけに絞る。作ったらチャンネル ID（`C` 始まり）を控える。パブリックチャンネルの ID を入れると、Add した時点で `Bidirectional Slack communication is only supported in private channels` で弾かれる
2. そのチャンネルに東京リージョンのアプリを招待する。`/invite @AWS DevOps Agent - AP (Tokyo)`。リージョンごとにアプリが別なので、名前の後ろのリージョン表記まで一致していないと紐付かない
3. コンソール（`ops-tooling`）で Agent Space → Capabilities → Communications → Add。登録済みのワークスペースを選び、チャンネル ID を入れる
4. Bidirectional mode を ON にし、IAM ロールは「Auto-create a new DevOps Agent role」を選ぶ。コンソールが `AIDevOpsChannelAccessPolicy` を付けたロールを作る
5. Add で関連付けを作り、Integrations の表で Bidirectional が Enabled、Bidirectional role にロール ARN が出ることを確認する
6. Slack に戻り、そのチャンネルでトップレベルのメッセージとして `@AWS DevOps Agent - AP (Tokyo) setup` を送る。チャンネルを Agent Space に紐付けた旨の投稿が返れば完了

`setup` は紐付けが壊れたときの直し方も兼ねている。反応しなくなったらもう一度送る。`/setup` というスラッシュコマンドは無い。

### 作られるロールの中身

コンソールが付ける `AIDevOpsChannelAccessPolicy` は1文だけの管理ポリシー。

```json
{
  "Sid": "AllowChatActions",
  "Effect": "Allow",
  "Action": ["aidevops:CreateChat", "aidevops:SendMessage"],
  "Resource": "arn:aws:aidevops:*:*:agentspace/${aws:PrincipalTag/AgentSpaceId}",
  "Condition": { "StringEquals": { "aws:ResourceAccount": "${aws:PrincipalAccount}" } }
}
```

許しているのはチャットの開始とメッセージ送信だけで、宛先はプリンシパルタグ `AgentSpaceId` で絞られる。ロールにこのタグが無い、あるいは値が違うと何も通らない。自分でロールを作るとここを落としやすいので、自動作成を選んでいる。

調査そのものの権限はこのロールとは別で、アプリ本体アカウントの `sakekasu-dev-devops-agent-monitoring` が持っている。そちらは読み取り専用のままなので、Slack から何を頼んでもリソースは変わらない。Operator ロールを作っていないことが、そのまま双方向のガードレールになっている。

### 使い方

会話はトップレベルのメンションで始める。返答は元メッセージのスレッドに付く。

```
@AWS DevOps Agent - AP (Tokyo) 直近の appsync-5xx の調査状況を教えて
```

スレッドの中で続けるときも毎回メンションが要る。落とすと無視される。別の話を始めたいときは、スレッドではなく新しいトップレベルのメッセージにする。

頼めるのは Agent Space の設定と権限の範囲で、調査の開始・確認・誘導、リソースやメトリクス・ログ・トポロジーの照会、予防提案（Evaluations）への返答あたり。製品へのフィードバックもメンションで送れて、エージェントが内容を要約して確認したうえで AWS に投げる。

### 費用の増え方

チャットも調査・評価と同じ $0.0083/秒で課金される。これまで自動調査だけだった稼働時間に、人が始めた分が上乗せされる。1回の質問で数十秒から数分動く前提で見ておく。

使うのをやめたくなったら、関連付けを Edit して Bidirectional mode を OFF にすればそのチャンネルは一方向通知に戻る。チャンネルごと外すなら Remove。どちらもワークスペースの登録は残る。

### 反応しないときに見るところ

- **投げているチャンネルが双方向のものか。** パブリックチャンネルで話しかけても無反応のまま返事は来ない。
  アラームが流れてくる `#sakekasu-builder-alarm` に質問を投げて詰まった実績がある。会話は双方向用のプライベートチャンネルで
- 東京リージョンのアプリがそのチャンネルのメンバーになっているか。リージョン違いのアプリを招待していないか
- コンソールの Integrations で Bidirectional が Enabled か、表示されているロールが実在するか
- 会話の最初のメッセージでアプリをメンションしているか。返答がすでにスレッドに付いていないか
- 紐付けが生きているか。怪しければ `setup` をもう一度送る

関連付けを作る画面でワークスペースが選択肢に出てこないときは、Agent Space と同じアカウント・同じリージョンで Slack を登録したかを疑う。

### コードにしていない理由

CloudFormation の `AWS::DevOpsAgent::Association` には Slack 用の設定があるが、中身は `WorkspaceId` / `WorkspaceName` / `TransmissionTarget` の3つだけで、双方向のフィールドが無い。API と SDK には `SlackBidirectionalConfiguration`（`enabled` と `roleArn`）があるが、CDK からは書けないので、関連付けはコンソールで作っている。

## カスタムスキルに入れておく運用ナレッジ

エージェントは汎用の知識しか持たないので、このプロジェクト固有の勘所はカスタムスキルとして登録しておく。切り分けが速くなる。

- AgentCore Runtime のメトリクスは名前空間 `AWS/Bedrock-AgentCore`、ディメンションは `ResourceId`（Runtime の ARN）
- 外形監視はソムリエ Runtime と AppSync を認証なしで叩き、401/403 が返ることを正常とみなす。200 が返る方が異常
- 記録の保存は AppSync + DynamoDB、画像は S3、OCR とソムリエは Bedrock（Claude Haiku 4.5）

## 費用

エージェントの稼働時間に対して $0.0083/秒（約 $30/時）。動いた時間だけかかり、待機している間は課金されない。Agent Space を作って置いておくだけでは費用は出ないので、アラームが1回も鳴らなかった月の請求はゼロになる。月10回・1回8分の調査なら $40 前後。

課金されるのは調査（Investigation）・評価（Evaluation）・チャット（Chat request）の3つ。コンソールに4つ目として出る System Learning Hours は課金対象外。

Slack の双方向通信で増えるのはチャットの分。人がメンションした回数だけ稼働時間が乗るので、自動調査だけの頃より読みにくくなる。

このうち評価だけは平常時にも走る。既定で週1回の自動実行があり、インシデントが起きていなくても過去の調査を分析して改善提案を出す。オンデマンドだけにしたい場合はスケジュールを止められる。

最初の2ヶ月は無料トライアルがあり、月あたり Agent Space 10個・調査20時間・評価15時間・SRE タスク20時間まで無料。導入初期の検証はほぼゼロ円で済む。

月次の利用クレジットは付かない。クレジットは Business Support+ / Enterprise Support / Unified Operations のいずれかに入っているアカウントで、Support Center コンソール経由で有効化した場合の特典で、プライマリの `ops-tooling` は Basic のため対象外になる。サポートプランは組織の他アカウントに波及せず、アカウントごとに個別契約になるため、管理アカウントが Business Support+ でも引き継がれない。

機能自体は Basic のまま使える。CLI / CDK 経由のオンボーディングにサポートプランの要件は無く、純粋な従量課金になる。クレジット額は月 $8.7 相当（エージェント稼働で17分ほど）で、それを得るために管理アカウントへ Agent Space を置く方が割に合わない、という判断（Issue #67 のコメントを参照）。

転送 Lambda 側の費用は誤差の範囲（発報のたびに1回動くだけ）。共通基盤へ移したことで 4 アプリのアラームが調査に回るようになったので、鳴る回数のぶん稼働時間は増える。

## 注意事項

- Slack のワークスペース登録はアカウントレベルなので、登録すると同じアカウントの全 Agent Space から見える
- セカンダリのロールは調査のため読み取り範囲が広い。信頼条件を Agent Space の ARN に絞ったうえで、変更系の操作は Permission Boundary や SCP で止める
- タグで検出の範囲を絞ったつもりでも、エージェントが読める範囲は狭まらない。タグはトポロジの材料で、調査はサービス API を直接叩くこともある（手順8）。絞るならロールのポリシー側で絞る
- 作業のたびに `aws sts get-caller-identity` でプロファイルの向き先を確認する。プライマリとセカンダリを取り違えやすい
- 調査中にエージェントが発行する CloudWatch Logs Insights のクエリなどは、各サービス側で別途課金される
- 双方向のチャンネルに入っている人は誰でもエージェントを動かせる。秒課金なので、メンバーは運用に関わる人だけに絞る
- Slack アプリはリージョンごとに別。東京以外のアプリを招待しても反応しない

## 参考

- [About AWS DevOps Agent](https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent.html)
- [Connecting multiple AWS Accounts](https://docs.aws.amazon.com/devopsagent/latest/userguide/configuring-integrations-and-knowledge-connecting-multiple-aws-accounts.html)
- [Invoking DevOps Agent through Webhook](https://docs.aws.amazon.com/devopsagent/latest/userguide/configuring-integrations-and-knowledge-invoking-devops-agent-through-webhook.html)
- [Connecting Slack](https://docs.aws.amazon.com/devopsagent/latest/userguide/connecting-to-ticketing-and-chat-connecting-slack.html)
- [AIDevOpsChannelAccessPolicy（双方向用の管理ポリシー）](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AIDevOpsChannelAccessPolicy.html)
- [AWS::DevOpsAgent::Association](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-devopsagent-association.html)
- [Pricing](https://aws.amazon.com/devops-agent/pricing)
