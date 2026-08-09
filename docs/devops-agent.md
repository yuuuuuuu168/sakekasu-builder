# AWS DevOps Agent 連携（#67）

アラームが鳴ってから人間が調べ始めるまでの時間をなくすための仕組み。CloudWatch アラームが発報したら、そのまま AWS DevOps Agent に調査を依頼する。エージェントはテレメトリ・ログ・デプロイ履歴を突き合わせて根本原因と緩和策をまとめ、専用の Slack チャンネルに投稿する。

```
CloudWatch アラーム ─┐
外形監視・カナリア ──┼→ SNS（dev-sakekasu-alerts）┬→ Slack 通知 Lambda → Slack（既存のアラートチャンネル）
AWS Health ──────────┘                            │
                                                  └→ 転送 Lambda → DevOps Agent Webhook
                                                                        ↓
                                                     自動調査 → Slack（DevOps Agent 専用チャンネル）
```

既存の Slack 通知はそのまま残る。転送 Lambda は同じトピックをもう1つの購読者として横から受け取るだけなので、エージェントが止まってもアラート自体は届く。

## アカウント構成

| 役割 | アカウント | プロファイル |
|------|-----------|-------------|
| プライマリ（Agent Space を置く） | `<管理アカウント ID>` | `yuuuuuuuki7749` |
| セカンダリ（調査対象＝アプリ本体） | `<アプリのアカウント ID>` | `sakekasu-builder` |

Agent Space はプライマリに集約する。AWS Security Agent が同じアカウントで動いており、フロンティアエージェント系をまとめたいため。調査対象はアプリ本体のアカウントなので、そちら側にクロスアカウントロールを置き、DevOps Agent のサービスプリンシパル（`aidevops.amazonaws.com`）から直接引き受けさせる。

リージョンは `ap-northeast-1`。

## リポジトリに入っているもの

コンソール側（Agent Space・Slack・GitHub 連携）は手作業で、アプリ本体アカウント側は CDK で作る。スタックは `sakekasu-dev-devops-agent`（`infra/lib/devops-agent-stack.ts`）で、中身は2つ。

### 調査用のクロスアカウントロール

`dev-sakekasu-devops-agent-monitoring`。読み取り専用の管理ポリシー `AIDevOpsAgentAccessPolicy` だけを持ち、これに加えて Resource Explorer のサービスリンクロール作成だけを許可する。アクション実行用（Operator）のロールは作っていない。まず調査だけ任せ、実行が必要になってから最小権限で足す。

信頼条件は `aws:SourceAccount`（プライマリのアカウント ID）と `aws:SourceArn`（Agent Space の ARN）の両方で絞る。混乱した代理人（confused deputy）を防ぐための条件で、AWS のドキュメントもこの形を推奨している。

### アラーム転送 Lambda

`dev-sakekasu-devops-agent-webhook`（`infra/lambda/devops-agent-webhook/`）。アラートトピックを購読し、DevOps Agent の Webhook に調査依頼を投げる。

調査に回すのは、次の条件を満たすものだけ。エージェントは秒課金なので、鳴ったもの全部を投げると費用が読めなくなる。

- CloudWatch アラームが `ALARM` に変わったとき。復旧（`OK`）とデータ不足では投げない
- AWS Health のうち `issue`（実際の障害）だけ。予定された変更やお知らせは投げない
- 転送 Lambda 自身の失敗アラーム（`dev-sakekasu-devops-agent-webhook-failure`）は捨てる。届かないことを届けようとして調査が積み上がるのを避けるため

調査の識別子は「アラーム名 + 状態が変わった時刻」で作る。SNS が再試行しても同じ値になるので調査は1件に収まり、2度目の発報では別の値になるので重複として捨てられない。

優先度は人間が「今すぐ見るべきか」を判断するためのもの。エージェントの調査の深さは変わらない。

| 優先度 | 対象 |
|--------|------|
| CRITICAL | サイトが開けない、GraphQL が 5xx（`health-check-frontend`, `appsync-5xx`） |
| HIGH | ソムリエ・OCR・記録の読み書きの故障、その他の外形監視 |
| MEDIUM | 利用者から見えない失敗（通知の失敗、画像削除の失敗、監視の停止） |

表に無いアラームは HIGH に倒す。増やしたときに黙って埋もれるより、鳴りすぎて表を直す方を選んでいる。

認証は HMAC を使う。本文と時刻をまとめて署名鍵でハッシュ化し、`x-amzn-event-signature` ヘッダーで送る。Bearer トークンより設定は面倒だが、鍵そのものが通信に乗らず、時刻が署名に入るので再送も弾ける。

## セットアップ手順

Agent Space の ARN と Webhook の鍵が決まらないと CDK 側が意味を持たないため、コンソール作業が先。

### 1. Agent Space を作る（プライマリ）

DevOps Agent のコンソールに `yuuuuuuuki7749` で入り、`ap-northeast-1` で Agent Space を作る。作成後、ARN（`arn:aws:aidevops:ap-northeast-1:<管理アカウント ID>:agentspace/xxxxxxxx`）を控える。

Security Agent 用の既存 Agent Space（`appsignals-fargate-poc`）とは分ける。調査対象も通知先チャンネルも別で、混ぜると Slack の投稿がどちらのものか分からなくなる。

### 2. Slack を繋ぐ

アカウントレベルで Slack を Capability Provider として登録し、Agent Space にチャンネル ID を紐付ける。投稿は既存のアラートチャンネルと分け、DevOps Agent 専用チャンネルを新しく作る。調査の経過報告が細かく量も多いため、混ぜるとアラート本体が流れていく。

認可のときに Enterprise Grid を選ばない。ワークスペース単位でインストールする。またインストールした Slack アプリはアンインストールしない。再インストールできなくなる可能性があると公式に注意書きがある。

プライベートチャンネルに投げるなら `/invite @AWS DevOps Agent` で Bot を招待しておく。

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

`agentSpaceArn` がコンテキストに入っているときだけスタックが合成される。まずは手元で確認する。

```bash
cd infra
AWS_PROFILE=sakekasu-builder npx cdk deploy sakekasu-dev-devops-agent -c env=dev \
  -c agentSpaceArn=arn:aws:aidevops:ap-northeast-1:<管理アカウント ID>:agentspace/xxxxxxxx
```

動作を確認したら `infra/cdk.json` の `context` に `agentSpaceArn` を書いてコミットする。以降は他のスタックと同じく、main へのマージで GitHub Actions が更新する。

```json
{
  "context": {
    "env": "dev",
    "agentSpaceArn": "arn:aws:aidevops:ap-northeast-1:<管理アカウント ID>:agentspace/xxxxxxxx"
  }
}
```

Agent Space の ARN は秘密ではない（引き受けには IAM の信頼条件が要る）ので、リポジトリに置いて問題ない。

### 7. セカンダリアカウントを Agent Space に登録する

デプロイの出力 `MonitoringRoleArn` を控え、コンソールの Capabilities タブ → Cloud → Secondary sources → Add から登録する。ウィザードはロールを自分で作らせようとするが、ここでは CDK が作ったロールの ARN を渡す。

続けてリソース検出を設定する。対象は既存の CloudFormation スタック3つ。

- `sakekasu-dev-auth`
- `sakekasu-dev-api`
- `sakekasu-dev-monitoring`

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

## カスタムスキルに入れておく運用ナレッジ

エージェントは汎用の知識しか持たないので、このプロジェクト固有の勘所はカスタムスキルとして登録しておく。切り分けが速くなる。

- ソムリエのカナリアが 403 を返したら、`sommelier/agentcore/agentcore.json` の2箇所（Runtime の `allowedClients` と、アプリ内 audience 検証用の環境変数 `COGNITO_APP_CLIENT_ID`）を確認する。片方だけではゲートウェイを通ってもアプリ内で弾かれる
- AgentCore Runtime のメトリクスは名前空間 `AWS/Bedrock-AgentCore`、ディメンションは `ResourceId`（Runtime の ARN）
- 外形監視はソムリエ Runtime と AppSync を認証なしで叩き、401/403 が返ることを正常とみなす。200 が返る方が異常
- 新規登録の通知 Lambda は失敗しても例外を投げない（サインアップ自体を壊さないため）。失敗はログから起こした `SignupNotifyFailCount` メトリクスにだけ現れる
- 記録の保存は AppSync + DynamoDB、画像は S3、OCR とソムリエは Bedrock（Claude Haiku 4.5）

## 費用

エージェントの稼働時間に対して $0.0083/秒（約 $30/時）。調査・評価・チャットとも同じレートで、動いた時間だけかかる。月10回・1回8分なら $40 前後。

最初の2ヶ月は無料トライアルがあり、月あたり Agent Space 10個・調査20時間・評価15時間・SRE タスク20時間まで無料。導入初期の検証はほぼゼロ円で済む。

プライマリアカウントは Business Support+ 契約なので、前月のサポート料金の30%が DevOps Agent 用クレジットとして毎月付与される。サポート料金がミニマムの $29 なら月 $8.7 相当、エージェント稼働で17分ほど。クレジットはその月のうちに使わないと失効し、繰り越せない。

転送 Lambda 側の費用は誤差の範囲（発報のたびに1回動くだけ）。

## 注意事項

- Slack のワークスペース登録はアカウントレベルなので、登録すると同じアカウントの全 Agent Space から見える
- セカンダリのロールは調査のため読み取り範囲が広い。信頼条件を Agent Space の ARN に絞ったうえで、変更系の操作は Permission Boundary や SCP で止める
- 作業のたびに `aws sts get-caller-identity` でプロファイルの向き先を確認する。プライマリとセカンダリを取り違えやすい
- 調査中にエージェントが発行する CloudWatch Logs Insights のクエリなどは、各サービス側で別途課金される

## 参考

- [About AWS DevOps Agent](https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent.html)
- [Connecting multiple AWS Accounts](https://docs.aws.amazon.com/devopsagent/latest/userguide/configuring-integrations-and-knowledge-connecting-multiple-aws-accounts.html)
- [Invoking DevOps Agent through Webhook](https://docs.aws.amazon.com/devopsagent/latest/userguide/configuring-integrations-and-knowledge-invoking-devops-agent-through-webhook.html)
- [Connecting Slack](https://docs.aws.amazon.com/devopsagent/latest/userguide/connecting-to-ticketing-and-chat-connecting-slack.html)
- [Pricing](https://aws.amazon.com/devops-agent/pricing)
