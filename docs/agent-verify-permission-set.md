# AgentVerifyAccess（クラウドセッションのAWS確認用 Permission Set）

クラウドセッションから AWS を確認するための読み取り専用 Permission Set。[scripts/setup-aws-profile.sh](../scripts/setup-aws-profile.sh) が書き出す `verify` プロファイルが、この Permission Set を参照する。

## なぜ ReadOnlyAccess を使わないか

AWS 管理の `ReadOnlyAccess` は 2912 アクションを許可し、そこには利用者のデータが含まれる。実機で照合した結果は次のとおり。

| アクション | ReadOnlyAccess |
|---|---|
| `s3:GetObject`（画像バケットの中身） | 許可される |
| `dynamodb:GetItem` / `Query` / `Scan` | 許可される |
| `cognito-idp:ListUsers` / `AdminGetUser` | 許可される |
| `ssm:GetParameter*` | 許可される |
| `secretsmanager:GetSecretValue` | 許可されない |
| `kms:Decrypt` | 許可されない |
| `sts:AssumeRole` / `lambda:InvokeFunction` | 許可されない |

[infra/lib/cdkd-policies.ts](../infra/lib/cdkd-policies.ts) の `cdkdDiffStatements` でも、同じ理由で `ReadOnlyAccess` を避けている。PR から流れるロールと同じ方針をエージェントにも適用する。

## 構成

2912 アクションを列挙し続けるのは維持できないため、**`ReadOnlyAccess` を土台に明示 Deny を重ねる**。IAM では明示 Deny が Allow に常に勝つため、土台が将来広がっても機密側は塞がったままになる。

- アタッチする AWS 管理ポリシー: `ReadOnlyAccess`
- インラインポリシー: [agent-verify-deny-policy.json](agent-verify-deny-policy.json)

CloudWatch Logs・メトリクス・Application Signals・X-Ray は**意図的に Deny していない**。障害調査でログ本文とトレースを読む必要があるため。ログ本文には Cognito sub が入りうることを承知のうえで許可している。ただし `logs:Unmask`（Data Protection のマスクを外す操作）は [cdkd-policies.ts](../infra/lib/cdkd-policies.ts) と揃えて Deny する。

画像バケットは `s3:ListBucket` も Deny する。キーが `{cognito-sub}/{recordType}/{recordId}/{fileName}` の形（[presigned-url/index.ts](../infra/lambda/presigned-url/index.ts)）で、一覧するだけで利用者の Cognito sub が列挙できてしまうため。オブジェクト本文を読めなくても、これは利用者の識別子そのものが漏れる。アプリ側もログから sub を伏せており、そこと方針を揃える。CDK のアセットバケットなどは調査に使うので、Deny は画像バケットに限定する。

一方、次は Deny していない。名前や設定は漏れるが値は漏れず、障害調査での利用価値が上回るため。

- `secretsmanager:ListSecrets` / `DescribeSecret`（シークレット名とローテーション設定。値は `GetSecretValue` 側で Deny 済み）
- `ssm:DescribeParameters`（パラメータ名。値は `GetParameter*` 側で Deny 済み）
- `cognito-idp:DescribeUserPool` / `DescribeUserPoolClient` / `ListGroups`（プールの設定。利用者そのものは `ListUsers` / `AdminGetUser` 側で Deny 済み）

## 管理アカウントで追加した Deny

`AgentVerifyAccess` は管理アカウント（<管理アカウント ID>）と運用ツール用アカウント（<運用アカウント ID>）にも割り当てている（`verify-org` / `verify-ops`）。Permission Set は 1 つなので、インラインポリシーも 3 アカウント共通になる。

管理アカウントでは、土台の `ReadOnlyAccess` のままだと Identity Center の利用者の個人情報が読める。IAM のポリシーシミュレーター（`iam simulate-principal-policy`）で確かめた結果、次がすべて `allowed` だった。

- `identitystore:ListUsers` / `DescribeUser` など：ユーザー名・氏名・メールアドレス
- `identitystore:ListGroupMemberships` など：誰がどのグループに入っているか
- `sso-directory:SearchUsers` など：同じ情報の旧 API（コンソール用）
- `account:GetContactInformation` / `GetAlternateContact` / `GetPrimaryEmail`：アカウントの連絡先（住所・電話・メール）

これを `DenyDirectoryAndContactReads` で塞ぐ。`identitystore` はアクション名を `identitystore:*User*` のようにワイルドカードで書き、同じ系統の API が増えても漏れないようにしている。旧 API の `sso-directory` は名前の形で絞ると `DescribeDirectory` のような読み取りが漏れる（AWS Security Agent の指摘）うえ、グループは `identitystore` 側で見られるので、`sso-directory:*` で丸ごと塞ぐ。

調査に使うので、次は Deny していない。

| 残すもの | 理由 |
|---|---|
| `identitystore:ListGroups` / `DescribeGroup` | グループ名だけで、所属者は出ない |
| `sso:ListAccountAssignments` / `ListPermissionSets` / `DescribePermissionSet` など | 割り当ての確認に要る。出るのはプリンシパル ID で、名前やメールは出ない |
| `organizations:ListAccounts` / `DescribeAccount` | 組織の構成の確認に要る。各アカウントのルートのメールアドレスは出る |
| Cost Explorer・CloudTrail・CloudWatch Logs | 請求と障害調査に要る |

適用は、管理アカウントの管理者権限で `put-inline-policy-to-permission-set` を流し、下の「設定が正しいかを確かめる」にある再プロビジョニングまで行う（`ALL_PROVISIONED_ACCOUNTS` なので 3 アカウントのロールがまとめて更新される）。クラウドセッションからは `deny-aws-writes.sh` が止めるので、人が手で流す。

追加後の判定は、適用前に同じシミュレーターへポリシーを渡して確かめた（`--policy-input-list`）。上の 4 系統は `explicitDeny`、残すものは `allowed` になる。適用後は同じコマンドから `--policy-input-list` を外して、実体のロールで同じ結果になることを確かめる。

```sh
ROLE=arn:aws:iam::<管理アカウント ID>:role/aws-reserved/sso.amazonaws.com/ap-northeast-1/AWSReservedSSO_AgentVerifyAccess_<接尾辞>
aws iam simulate-principal-policy --profile verify-org --policy-source-arn $ROLE \
  --action-names identitystore:ListUsers identitystore:ListGroupMemberships sso-directory:SearchUsers \
    account:GetContactInformation identitystore:ListGroups sso:ListAccountAssignments organizations:ListAccounts \
  --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output text
```

## この Deny が届かないところ

明示 Deny は IAM の認可を通る呼び出しにしか効かない。**SSO Portal API（`aws sso ...`）と Cognito の利用者向け操作は SigV4 で署名されず**、access token だけで通るため、ここに何を書いても止まらない。CLI 同梱のモデルで確かめると `sso get-role-credentials` は `authtype: none` になっている。

とくに問題になるのは `sso get-role-credentials` で、`aws sso login` が作ったトークンを渡すと、**ログインした人に割り当てられている任意の Permission Set**（`AdministratorAccess` を含む）の一時認証情報が返る。`AgentVerifyAccess` で入っていても、同じ人が他の Permission Set を持っていればそちらに乗り換えられる。

[scripts/deny-aws-writes.mjs](../scripts/deny-aws-writes.mjs) は `sso login` を除く `sso` / `sso-oidc` と、IAM が届かない Cognito 操作をすべて落とすようにしてある。ただしトークンは `~/.aws/sso/cache/` に平文で置かれるので、CLI の動詞を止めるだけでは塞ぎきれない。

**この経路の本当の境界は Identity Center 側の割り当てにある。** クラウドセッションから `aws sso login` する人には `AgentVerifyAccess` 以外の Permission Set を割り当てない（別のユーザーを使う）のが、唯一の確実な塞ぎ方になる。

## 作成状況

作成・割り当て済み（2026-08-17）。IAM Identity Center は CDK 管理外のため手動で作成した。

| 項目 | 値 |
|---|---|
| インスタンス | `arn:aws:sso:::instance/<インスタンス ID>`（管理アカウント <管理アカウント ID> 所有） |
| Permission Set | `arn:aws:sso:::permissionSet/<インスタンス ID>/<Permission Set ID>` |
| セッション時間 | `PT12H`（既存の `AdministratorAccess` / `ReadOnlyAccess` に揃えた） |
| 割り当て先 | グループ `sakekasu`（既存もグループ割り当てのため揃えた）。アカウント 232791540685（アプリ、2026-08-17）、<管理アカウント ID>（管理）と <運用アカウント ID>（運用ツール）（2026-09-26 に追加） |

作り直す場合の手順は次のとおり。管理アカウント（<管理アカウント ID>）の認証が必要で、メンバーアカウントからは `sso:ListPermissionSets` すら通らない。

```sh
INST=arn:aws:sso:::instance/<インスタンス ID>

aws sso-admin create-permission-set --instance-arn $INST \
  --name AgentVerifyAccess \
  --description "Read-only access for Claude Code cloud sessions. Denies user data and secret reads." \
  --session-duration PT12H

aws sso-admin attach-managed-policy-to-permission-set --instance-arn $INST \
  --permission-set-arn <PERMISSION_SET_ARN> \
  --managed-policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess

aws sso-admin put-inline-policy-to-permission-set --instance-arn $INST \
  --permission-set-arn <PERMISSION_SET_ARN> \
  --inline-policy file://docs/agent-verify-deny-policy.json

aws sso-admin create-account-assignment --instance-arn $INST \
  --permission-set-arn <PERMISSION_SET_ARN> \
  --target-id 232791540685 --target-type AWS_ACCOUNT \
  --principal-id 97242a68-30e1-70ce-49a7-0ba461fb1bf2 --principal-type GROUP
```

なお [scripts/deny-aws-writes.sh](../scripts/deny-aws-writes.sh) により、クラウドセッションからは `create-*` / `put-*` 系が実行できない。これらはローカルまたは人間が手で流す。

## 設定が正しいかを確かめる

インラインポリシーの投入（3番目のコマンド）を飛ばすと、土台の `ReadOnlyAccess` がむき出しになり、利用者データが読める状態で気づけない。作成・変更のたびに、実際に入っている内容がリポジトリの定義と一致するか確認する。

```sh
INST=arn:aws:sso:::instance/<インスタンス ID>
PS=arn:aws:sso:::permissionSet/<インスタンス ID>/<Permission Set ID>

aws sso-admin get-inline-policy-for-permission-set --instance-arn $INST \
  --permission-set-arn $PS --query InlinePolicy --output text > /tmp/live.json
python3 -c "import json;print('一致' if json.load(open('/tmp/live.json'))==json.load(open('docs/agent-verify-deny-policy.json')) else '不一致')"
```

**`put-inline-policy-to-permission-set` だけでは対象アカウントに効かない。** コマンドは成功し、`get-inline-policy-for-permission-set` も新しい内容を返すが、アカウント側の IAM ロールは古いままになる。実際に一度これで「直したつもり」の状態になった。必ず再プロビジョニングし、対象アカウントのロールまで見て確認する。

```sh
aws sso-admin provision-permission-set --instance-arn $INST \
  --permission-set-arn $PS --target-type ALL_PROVISIONED_ACCOUNTS

# Status が SUCCEEDED になるまで待つ
aws sso-admin describe-permission-set-provisioning-status --instance-arn $INST \
  --provision-permission-set-request-id <REQUEST_ID> --query 'PermissionSetProvisioningStatus.Status'

# 対象アカウント（232791540685）側で、実体のロールに入っているか確かめる
aws iam get-role-policy --role-name AWSReservedSSO_AgentVerifyAccess_13e5a14e9d6af7d8 \
  --policy-name AwsSSOInlinePolicy --query 'PolicyDocument.Statement[].Sid'
```

## 動作確認（実施済みの結果）

`aws sso login --profile verify --use-device-code` の後、実機で次を確認した。

| コマンド | 結果 |
|---|---|
| `sts get-caller-identity` | `AWSReservedSSO_AgentVerifyAccess_...` として成功 |
| `logs describe-log-groups` / `filter-log-events` | 通る |
| `cloudwatch describe-alarms` / `get-metric-data` | 通る |
| `dynamodb list-tables` / `s3api list-buckets` / `lambda list-functions` | 通る（構造の把握は残す） |
| `dynamodb scan` / `get-item` | AccessDenied |
| `s3api get-object`（`dev-sakekasu-images` の実オブジェクト） | AccessDenied（explicit deny） |
| `s3api list-objects-v2` / `s3 ls`（`dev-sakekasu-images`） | AccessDenied（Cognito sub の列挙を防ぐ） |
| `s3api list-objects-v2`（CDK アセットバケット） | 通る（Deny は画像バケットに限定） |
| `ssm get-parameter` / `secretsmanager get-secret-value` | AccessDenied |
| `cognito-idp list-users` | AccessDenied |
| `s3api put-object` / `lambda invoke` | AccessDenied |

`s3api get-object` を試すときは**実在するオブジェクトのキー**を使うこと。存在しないキーだと、`s3:ListBucket` を持っているぶん S3 が `NoSuchKey`（404）を返し、GetObject の認可結果が観測できない。

## 変更したくなったら

S3 の state バケットなど、特定バケットだけ読みたくなった場合は `DenyUserDataReads` を `NotResource` 付きの文に分けて例外を切る。Deny の対象を丸ごと外さないこと。
