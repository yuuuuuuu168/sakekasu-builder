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

## 作成手順（IIC 管理アカウントで1回だけ）

IAM Identity Center は CDK 管理外のため手動で作成する。

```sh
# 1. Permission Set を作る
aws sso-admin create-permission-set \
  --instance-arn <INSTANCE_ARN> \
  --name AgentVerifyAccess \
  --description "Read-only access for Claude Code cloud sessions. Denies user data and secret reads." \
  --session-duration PT4H

# 2. ReadOnlyAccess をアタッチする
aws sso-admin attach-managed-policy-to-permission-set \
  --instance-arn <INSTANCE_ARN> \
  --permission-set-arn <PERMISSION_SET_ARN> \
  --managed-policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess

# 3. Deny のインラインポリシーを入れる
aws sso-admin put-inline-policy-to-permission-set \
  --instance-arn <INSTANCE_ARN> \
  --permission-set-arn <PERMISSION_SET_ARN> \
  --inline-policy file://docs/agent-verify-deny-policy.json

# 4. アカウント <アプリのアカウント ID> に、自分のユーザーで割り当てる
aws sso-admin create-account-assignment \
  --instance-arn <INSTANCE_ARN> \
  --permission-set-arn <PERMISSION_SET_ARN> \
  --target-id <アプリのアカウント ID> --target-type AWS_ACCOUNT \
  --principal-id <USER_ID> --principal-type USER
```

`<INSTANCE_ARN>` は `aws sso-admin list-instances` で、`<USER_ID>` は `aws identitystore list-users --identity-store-id <ID>` で取得する。

## 動作確認

割り当て後、次が期待どおりになること。

```sh
aws sso login --profile verify --use-device-code
aws sts get-caller-identity --profile verify                    # 成功する
aws logs describe-log-groups --profile verify                    # 成功する（可観測性は残す）
aws dynamodb scan --table-name <records-table> --profile verify  # AccessDenied になる
aws s3api get-object --bucket <images-bucket> --key x /tmp/x --profile verify  # AccessDenied になる
```

## 変更したくなったら

S3 の state バケットなど、特定バケットだけ読みたくなった場合は `DenyUserDataReads` を `NotResource` 付きの文に分けて例外を切る。Deny の対象を丸ごと外さないこと。
