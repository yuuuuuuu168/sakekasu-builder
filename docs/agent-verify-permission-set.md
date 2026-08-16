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

CloudWatch Logs・メトリクス・Application Signals・X-Ray は**意図的に Deny していない**。障害調査でログ本文とトレースを読む必要があるため。ログ本文には Cognito sub が入りうることを承知のうえで許可している。

## 作成状況

作成・割り当て済み（2026-08-17）。IAM Identity Center は CDK 管理外のため手動で作成した。

| 項目 | 値 |
|---|---|
| インスタンス | `arn:aws:sso:::instance/<インスタンス ID>`（管理アカウント <管理アカウント ID> 所有） |
| Permission Set | `arn:aws:sso:::permissionSet/<インスタンス ID>/<Permission Set ID>` |
| セッション時間 | `PT12H`（既存の `AdministratorAccess` / `ReadOnlyAccess` に揃えた） |
| 割り当て先 | アカウント <アプリのアカウント ID> / グループ `sakekasu`（既存もグループ割り当てのため揃えた） |

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
  --target-id <アプリのアカウント ID> --target-type AWS_ACCOUNT \
  --principal-id 97242a68-30e1-70ce-49a7-0ba461fb1bf2 --principal-type GROUP
```

なお `.claude/settings.json` の deny により、Claude Code のセッションからは `create-*` / `put-*` 系が実行できない。これらは人間が手で流す。

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
| `ssm get-parameter` / `secretsmanager get-secret-value` | AccessDenied |
| `cognito-idp list-users` | AccessDenied |
| `s3api put-object` / `lambda invoke` | AccessDenied |

`s3api get-object` を試すときは**実在するオブジェクトのキー**を使うこと。存在しないキーだと、`s3:ListBucket` を持っているぶん S3 が `NoSuchKey`（404）を返し、GetObject の認可結果が観測できない。

## 変更したくなったら

S3 の state バケットなど、特定バケットだけ読みたくなった場合は `DenyUserDataReads` を `NotResource` 付きの文に分けて例外を切る。Deny の対象を丸ごと外さないこと。
