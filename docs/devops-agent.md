# AWS DevOps Agent 連携（#67）

アラームが鳴ってから人間が調べ始めるまでの時間をなくすための仕組み。CloudWatch アラームが発報したら、そのまま AWS DevOps Agent に調査を依頼する。エージェントはテレメトリ・ログ・デプロイ履歴を突き合わせて根本原因と緩和策をまとめ、専用の Slack チャンネルに投稿する。

投稿を読んだ側から追加で頼みたくなったぶんは、双方向用のプライベートチャンネルで受ける。メンションで調査を始めたり、経過を聞いたりできる（[Slack の双方向通信](#slack-の双方向通信)）。

```
CloudWatch アラーム ─┐
外形監視・カナリア ──┴→ SNS（dev-sakekasu-alerts）┬→ Slack 通知 Lambda → Slack（既存のアラートチャンネル）
                                                  │
                                                  └→ 転送 Lambda → DevOps Agent Webhook
                                                                        ↓
                                                     自動調査 → Slack（DevOps Agent 専用チャンネル）

人 ⇄ Slack（双方向用プライベートチャンネル）⇄ DevOps Agent
     メンションで調査の開始・経過の照会・追加の指示
```

既存の Slack 通知はそのまま残る。転送 Lambda は同じトピックをもう1つの購読者として横から受け取るだけなので、エージェントが止まってもアラート自体は届く。

## アカウント構成

| 役割 | アカウント | プロファイル |
|------|-----------|-------------|
| プライマリ（Agent Space を置く） | `<運用アカウント ID>` | `ops-tooling` |
| セカンダリ（調査対象＝アプリ本体） | `232791540685` | `sakekasu-builder` |

Agent Space は運用ツール専用のメンバーアカウント `ops-tooling` に集約する。DevOps Agent は Slack・GitHub・Webhook という外部との接点を持つワークロードで、Organization の管理アカウントは唯一 SCP の制約を受けない場所にあたるため、事故を組織のガードレールで止められる側に置く。AWS Security Agent も同じ理由で `ops-tooling` へ移す（Issue #107）。

調査対象はアプリ本体のアカウントなので、そちら側にクロスアカウントロールを置き、DevOps Agent のサービスプリンシパル（`aidevops.amazonaws.com`）から直接引き受けさせる。

リージョンは `ap-northeast-1`。

## リポジトリに入っているもの

コンソール側（Agent Space・Slack・GitHub 連携）は手作業で、アプリ本体アカウント側は CDK で作る。スタックは `sakekasu-dev-devops-agent`（`infra/lib/devops-agent-stack.ts`）で、中身は2つ。

### 調査用のクロスアカウントロール

`sakekasu-dev-devops-agent-monitoring`。読み取り専用の管理ポリシー `AIDevOpsAgentAccessPolicy` だけを持ち、これに加えて Resource Explorer のサービスリンクロール作成だけを許可する。アクション実行用（Operator）のロールは作っていない。まず調査だけ任せ、実行が必要になってから最小権限で足す。

名前だけ他のリソースと向きが違う（`dev-sakekasu-` ではなく `sakekasu-dev-`）。cdkd のデプロイロールが `role/sakekasu-*` にしか `iam:CreateRole` を持っておらず、`dev-` 始まりだと作れないため。スタック名 `sakekasu-dev-devops-agent` には揃っている。

信頼条件は `aws:SourceAccount`（プライマリのアカウント ID）と `aws:SourceArn`（Agent Space の ARN）の両方で絞る。混乱した代理人（confused deputy）を防ぐための条件で、AWS のドキュメントもこの形を推奨している。

### アラーム転送 Lambda

`dev-sakekasu-devops-agent-webhook`（`infra/lambda/devops-agent-webhook/`）。アラートトピックを購読し、DevOps Agent の Webhook に調査依頼を投げる。

調査に回すのは、次の条件を満たすものだけ。エージェントは秒課金なので、鳴ったもの全部を投げると費用が読めなくなる。

- CloudWatch アラームが `ALARM` に変わったとき。復旧（`OK`）とデータ不足では投げない
- AWS Health のうち `issue`（実際の障害）だけ。予定された変更やお知らせは投げない。ただし AWS Health の通知は共通基盤（sakekasu-integrated_environment）へ移したので、いまはこのトピックに流れてこない。転送 Lambda の判定は残してある
- 転送 Lambda 自身の失敗アラーム（`dev-sakekasu-devops-agent-webhook-failure`）は捨てる。届かないことを届けようとして調査が積み上がるのを避けるため

調査の識別子は「アラーム名 + 状態が変わった時刻」で作る。SNS が再試行しても同じ値になるので調査は1件に収まり、2度目の発報では別の値になるので重複として捨てられない。

優先度は人間が「今すぐ見るべきか」を判断するためのもの。エージェントの調査の深さは変わらない。

| 優先度 | 対象 |
|--------|------|
| CRITICAL | サイトが開けない、GraphQL が 5xx（`health-check-frontend`, `appsync-5xx`） |
| HIGH | ソムリエ・OCR・記録の読み書きの故障、その他の外形監視 |
| MEDIUM | 利用者から見えない失敗（通知の失敗、画像削除の失敗、監視の停止） |

表に無いアラームは HIGH に倒す。増やしたときに黙って埋もれるより、鳴りすぎて表を直す方を選んでいる。

判定は上から順に見て最初に当たったものを使うが、MEDIUM だけは HIGH より先に評価する。`watcher-failure-sommelier-canary` のように監視の停止を表すアラームが名前に `sommelier` を含んでおり、順に見ると「ソムリエの故障」として HIGH に落ちてしまうため。壊れているのは監視の側なので MEDIUM が正しい。

認証は HMAC を使う。本文と時刻をまとめて署名鍵でハッシュ化し、`x-amzn-event-signature` ヘッダーで送る。Bearer トークンより設定は面倒だが、鍵そのものが通信に乗らず、時刻が署名に入るので再送も弾ける。

送り先のホストは `*.api.aws` だけを許している（実際の形は `https://event-ai.<region>.api.aws/webhook/generic/<id>`）。内部向けのアドレスを1つずつ弾く書き方もできるが、同じ宛先は `::ffff:169.254.169.254` のような別表記でも書けるため、塞ぎ漏れを追いかけ続けることになる。送り先が1つに決まっているなら、許す形だけを書く方が確実で、任意の外部ドメインへの送信も同時に塞げる。AWS 側がホスト名を変えたら `assertHttpsUrl` の許可パターンも直す（疎通確認で気づける）。リダイレクトは追わない設定にしてあるので、検証を通っていない先へ本文が渡ることもない。

## セットアップ手順

Agent Space の ARN と Webhook の鍵が決まらないと CDK 側が意味を持たないため、コンソール作業が先。

### 1. Agent Space を作る（プライマリ）

DevOps Agent のコンソールに `ops-tooling` で入り、`ap-northeast-1` で Agent Space を作る。作成後、ARN（`arn:aws:aidevops:ap-northeast-1:<運用アカウント ID>:agentspace/xxxxxxxx`）を控える。

Security Agent の Agent Space（Issue #107 で同じ `ops-tooling` に移してくる）とは分ける。調査対象も通知先チャンネルも別で、混ぜると Slack の投稿がどちらのものか分からなくなる。

### 2. Slack を繋ぐ

アカウントレベルで Slack を Capability Provider として登録し、Agent Space にチャンネル ID を紐付ける。投稿は既存のアラートチャンネルと分け、DevOps Agent 専用チャンネルを新しく作る。調査の経過報告が細かく量も多いため、混ぜるとアラート本体が流れていく。

認可のときに Enterprise Grid を選ばない。ワークスペース単位でインストールする。またインストールした Slack アプリはアンインストールしない。再インストールできなくなる可能性があると公式に注意書きがある。

プライベートチャンネルに投げるなら、東京リージョンのアプリを `/invite @AWS DevOps Agent - AP (Tokyo)` で招待しておく。アプリはリージョンごとに別物で、名前の後ろのリージョン表記まで一致していないと紐付かない。入力中に候補が出るので、そこから選ぶのが確実。

ここまでは一方向の通知。Slack からエージェントに話しかける側は [Slack の双方向通信](#slack-の双方向通信) にまとめてある。

### 3. GitHub を繋ぐ

`yuuuuuuu168/sakekasu-builder` を接続する。デプロイとコミットの履歴が調査に入るため、「直前のマージで壊れた」型の障害で効く。

### 4. Webhook を発行する

Agent Space の Capabilities タブから Webhook を作る。認証方式は HMAC を選ぶ（転送 Lambda がその前提で署名している）。表示される URL と署名鍵はこの1回しか見られないので、その場で控える。

### 5. Webhook の設定をセカンダリに登録する

URL と鍵はリポジトリに置けないため、先に Secrets Manager へ入れる。CDK は名前で参照するだけ。

```bash
AWS_PROFILE=sakekasu-builder aws sts get-caller-identity

AWS_PROFILE=sakekasu-builder aws secretsmanager create-secret \
  --name dev-sakekasu/devops-agent/webhook \
  --secret-string '{"webhookUrl":"https://event-ai.ap-northeast-1.api.aws/webhook/generic/XXXX","signingSecret":"<署名鍵>"}' \
  --region ap-northeast-1
```

### 6. デプロイする

`agentSpaceArn` がコンテキストに入っているときだけスタックが合成される。`infra/cdk.json` の `context` に書いてあるので、main にマージすれば GitHub Actions の cdkd が作る。

```json
{
  "context": {
    "env": "dev",
    "agentSpaceArn": "arn:aws:aidevops:ap-northeast-1:<運用アカウント ID>:agentspace/<Agent Space ID>"
  }
}
```

Agent Space の ARN は秘密ではない（引き受けには IAM の信頼条件が要る）ので、リポジトリに置いて問題ない。

**手元から `npx cdk deploy` を打たない。** cdkd への移行で CloudFormation のスタックは削除されていて、リソースだけが残っている。その状態で `cdk deploy` を打つと、依存する auth / api / monitoring をゼロから作り直そうとして既存リソースと名前がぶつかる（[docs/cdkd-migration.md](cdkd-migration.md)）。計画を先に見たいときは PR の `cdk-diff` を読む。`infra/**` を触る PR では自動で走る。

### 7. セカンダリアカウントを Agent Space に登録する

コンソールの Capabilities タブ → Cloud → Secondary sources → Add から、調査用ロールを登録する。ウィザードはロールを自分で作らせようとするが、ここでは CDK が作ったものを渡す。

```
arn:aws:iam::232791540685:role/sakekasu-dev-devops-agent-monitoring
```

cdkd は CloudFormation を通らないのでスタックの出力が無い。ロール名は固定なので ARN はこの形になる。

続けてリソース検出を設定する。**タグで指定する。**

```
Project = sakekasu-builder
```

以前はここに CloudFormation スタック3つ（`sakekasu-dev-auth` / `-api` / `-monitoring`）を並べていたが、cdkd への移行でそのスタックは消えた。スタック指定は使えない。

#### タグの付け方

タグは CDK からではなく、Resource Groups Tagging API で直接付けてある（2026-10-04、52リソース）。CDK の `Tags.of` で付ける道は一度試して取り下げた。cdkd が取り込み済みリソースを改名してしまうのと、ロググループへのタグ付けが通らないため（[docs/cdkd-migration.md](cdkd-migration.md) の「取り込み済みリソースへの初回更新は改名になる」）。

合成テンプレートに `Tags` が無いので、cdkd はこのタグを管理対象外として素通りする。デプロイで消えることはない（`cdkd diff` が差分を出さないことを確認済み）。

裏を返すと、**リソースを足してもタグは自動では付かない**。監視対象を増やしたら付け直す。

```sh
PROFILE=sakekasu-builder
REGION=ap-northeast-1
ACCOUNT=232791540685
API_ID=6mtw5cju3naydf7mxnaoulowta

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

### 8. 動作を確認する

Slack を鳴らさずに転送だけ試すなら、Lambda を直接呼ぶ。

```bash
AWS_PROFILE=sakekasu-builder aws lambda invoke \
  --function-name dev-sakekasu-devops-agent-webhook \
  --region ap-northeast-1 \
  --payload '{"Records":[{"Sns":{"Message":"{\"AlarmName\":\"TEST-devops-agent\",\"AlarmDescription\":\"[TEST] 疎通確認です。調査は不要です\",\"NewStateValue\":\"ALARM\",\"NewStateReason\":\"[TEST] Webhook の疎通確認\",\"Region\":\"Asia Pacific (Tokyo)\"}","Timestamp":"2026-08-09T00:00:00.000Z"}}]}' \
  --cli-binary-format raw-in-base64-out /dev/stdout
```

DevOps Agent の Web アプリで `CloudWatch アラーム: TEST-devops-agent` の調査が始まれば通っている。

HTTP 200 が返るのに調査が始まらないときは、本文の形式か識別子の重複を疑う。同じ識別子で送ると重複として捨てられる。4xx が返るときは署名かヘッダーの問題。

## Slack の双方向通信

一方向の通知だけだと、調査結果を読んで「ではこのログをもう少し見たい」と思った時点で Web アプリに移ることになる。双方向にするとその往復が消える。メンションで調査を始め、経過を聞き、結果に追加の指示を出すところまで Slack の中で終わる。やり取りは元メッセージのスレッドに積まれるので、振り返りのときに誰が何を判断したかがそのまま残る。

### チャンネルの持ち方

双方向はプライベートチャンネルでしか有効にできない。パブリックチャンネルに紐付けた関連付けは一方向通知のままになる。

| チャンネル | 用途 | 向き |
|-----------|------|------|
| 既存のアラートチャンネル | Slack 通知 Lambda が投げるアラーム本体 | 一方向 |
| DevOps Agent 専用チャンネル | 自動調査の経過と結果 | 一方向 |
| 双方向用のプライベートチャンネル（新設） | エージェントとの会話 | 双方向 |

専用チャンネルを作り替えず新しく足すのは、会話を始めたい人だけをメンバーにしたいため。専用チャンネルは調査の投稿が細かく量も多いので、広く見せておく側に残す。

1つの Agent Space に2つのチャンネルを紐付けたとき、自動調査の投稿が両方に出るかどうかは公式ドキュメントに書かれていない。紐付けた直後にテストアラームを1本鳴らして確かめる。両方に出るなら専用チャンネル側の関連付けを Remove し、双方向のチャンネルに寄せる。

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

- 東京リージョンのアプリがそのチャンネルのメンバーになっているか。リージョン違いのアプリを招待していないか
- コンソールの Integrations で Bidirectional が Enabled か、表示されているロールが実在するか
- 会話の最初のメッセージでアプリをメンションしているか。返答がすでにスレッドに付いていないか
- 紐付けが生きているか。怪しければ `setup` をもう一度送る

関連付けを作る画面でワークスペースが選択肢に出てこないときは、Agent Space と同じアカウント・同じリージョンで Slack を登録したかを疑う。

### まだコードにできない

CloudFormation の `AWS::DevOpsAgent::Association` には Slack 用の設定があるが、中身は `WorkspaceId` / `WorkspaceName` / `TransmissionTarget` の3つだけで、双方向のフィールドがまだ無い。API と SDK には `SlackBidirectionalConfiguration`（`enabled` と `roleArn`）があるので、CloudFormation が追いつけば関連付けごと CDK に寄せられる。それまではコンソールでの手作業として残る。

## カスタムスキルに入れておく運用ナレッジ

エージェントは汎用の知識しか持たないので、このプロジェクト固有の勘所はカスタムスキルとして登録しておく。切り分けが速くなる。

- （ソムリエのカナリアは共通ログインへの移行で止めてある。docs/shared-login.md）カナリアが 403 を返したら、`sommelier/agentcore/agentcore.json` の2箇所（Runtime の `allowedClients` と、アプリ内 audience 検証用の環境変数 `COGNITO_APP_CLIENT_ID`）を確認する。片方だけではゲートウェイを通ってもアプリ内で弾かれる
- AgentCore Runtime のメトリクスは名前空間 `AWS/Bedrock-AgentCore`、ディメンションは `ResourceId`（Runtime の ARN）
- 外形監視はソムリエ Runtime と AppSync を認証なしで叩き、401/403 が返ることを正常とみなす。200 が返る方が異常
- （新規登録の通知は旧ユーザープールにだけ付いていて、共通ログインへの移行で役目を終えた）新規登録の通知 Lambda は失敗しても例外を投げない（サインアップ自体を壊さないため）。失敗はログから起こした `SignupNotifyFailCount` メトリクスにだけ現れる
- 記録の保存は AppSync + DynamoDB、画像は S3、OCR とソムリエは Bedrock（Claude Haiku 4.5）

## 費用

エージェントの稼働時間に対して $0.0083/秒（約 $30/時）。動いた時間だけかかり、待機している間は課金されない。Agent Space を作って置いておくだけでは費用は出ないので、アラームが1回も鳴らなかった月の請求はゼロになる。月10回・1回8分の調査なら $40 前後。

課金されるのは調査（Investigation）・評価（Evaluation）・チャット（Chat request）の3つ。コンソールに4つ目として出る System Learning Hours は課金対象外。

Slack の双方向通信で増えるのはチャットの分。人がメンションした回数だけ稼働時間が乗るので、自動調査だけの頃より読みにくくなる。

このうち評価だけは平常時にも走る。既定で週1回の自動実行があり、インシデントが起きていなくても過去の調査を分析して改善提案を出す。オンデマンドだけにしたい場合はスケジュールを止められる。

最初の2ヶ月は無料トライアルがあり、月あたり Agent Space 10個・調査20時間・評価15時間・SRE タスク20時間まで無料。導入初期の検証はほぼゼロ円で済む。

月次の利用クレジットは付かない。クレジットは Business Support+ / Enterprise Support / Unified Operations のいずれかに入っているアカウントで、Support Center コンソール経由で有効化した場合の特典で、プライマリの `ops-tooling` は Basic のため対象外になる。サポートプランは組織の他アカウントに波及せず、アカウントごとに個別契約になるため、管理アカウントが Business Support+ でも引き継がれない。

機能自体は Basic のまま使える。CLI / CDK 経由のオンボーディングにサポートプランの要件は無く、純粋な従量課金になる。クレジット額は月 $8.7 相当（エージェント稼働で17分ほど）で、それを得るために管理アカウントへ Agent Space を置く方が割に合わない、という判断（Issue #67 のコメントを参照）。

転送 Lambda 側の費用は誤差の範囲（発報のたびに1回動くだけ）。

## 注意事項

- Slack のワークスペース登録はアカウントレベルなので、登録すると同じアカウントの全 Agent Space から見える
- セカンダリのロールは調査のため読み取り範囲が広い。信頼条件を Agent Space の ARN に絞ったうえで、変更系の操作は Permission Boundary や SCP で止める
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
