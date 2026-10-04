# 共通ログインへの切り替え

このアプリのログインを、アプリ専用の Cognito ユーザープールから「共通ログイン」に移した。
共通ログインは [sakekasu-integrated_environment](https://github.com/yuuuuuuu168/sakekasu-integrated_environment) が持つユーザープールで、
4 つのアプリ（reinvent、builder、kakeibo、learning）がそれを共有する。

利用者は本人だけなので、ほかのアプリと同じく、ユーザーは管理者が手で作る形に寄せた。
以前のこのアプリだけにあったセルフサインアップと独自のサインイン画面はやめている。

## 何が変わったか

| | 以前 | いま |
| --- | --- | --- |
| ユーザープール | `sakekasu-dev-auth` の `dev-sakekasu-userpool`（このアプリ専用） | 共通ログインのプール（`infra/cdk.json` の `sharedAuth.userPoolId`） |
| アプリクライアント | `dev-sakekasu-client`（SRP） | 共通ログイン側の builder 用クライアント（Authorization code + PKCE のみ。シークレットなし） |
| ログイン画面 | アプリの中の独自画面（サインイン・サインアップ・パスワード再設定・TOTP 入力） | マネージドログイン（`https://auth.sakekasu-builder.com`）へリダイレクト |
| MFA | 任意（アプリの「MFA」ダイアログで登録） | 必須（TOTP）。登録も入力もマネージドログインの画面で行う |
| パスワード | 8 文字以上 | 16 文字以上 |
| ユーザーの作り方 | 画面からセルフサインアップ | 共通ログイン側で管理者が作る（そちらの `docs/identity.md`） |
| 新規登録の Slack 通知 | 旧プールの Post Confirmation トリガー | 役目を終えた（共通プールにセルフサインアップが無い）。旧プールと一緒に外した |
| トークンの有効期限 | アクセス 1 時間 / リフレッシュ 30 日 | 同じ |

接続先の値は `infra/cdk.json` の context `sharedAuth` に `{ domain, userPoolId, clientId }` で置いてある。
値の出どころは共通ログイン側の identity スタックの出力。スタック間の参照ではつながない（別リポジトリのスタックなので）。
`infra/scripts/generate-outputs.ts` はこの値を `amplify_outputs.json` の `auth`（`auth.oauth` にマネージドログインのドメイン）へ書く。

builder 用クライアントに許されている OAuth スコープは `openid` `email` `profile` だけで、
`aws.cognito.signin.user.admin` は無い。Amplify の `fetchUserAttributes`・`setUpTOTP`・
`updateMFAPreference`・`updatePassword` など、このスコープが要る API は使えない。
画面が使うのは `signInWithRedirect`・`signOut`・`getCurrentUser`（トークンのクレームを読むだけ）・
`fetchAuthSession`（ソムリエへ渡すアクセストークン）だけ。

戻り先とログアウト後の戻り先は、共通ログイン側に次の 3 つを登録してある。末尾の `/` まで完全一致でないと断られる。

- `https://sakekasu-builder.com/`
- `https://www.sakekasu-builder.com/`
- `http://localhost:5173/`

画面は開いているオリジンに `/` を付けた URL を戻り先にする（`src/features/auth/amplifyConfig.ts`）。
Amplify Hosting のプレビュー URL（`*.amplifyapp.com`）は登録していないので、そこからはログインできない。

## 何が共通ログインを見るようになったか

| 場所 | 変更 |
| --- | --- |
| AppSync（`infra/lib/api-stack.ts`） | 認可のユーザープールを共通プールに。`appIdClientRegex` で builder のクライアントのトークンだけを通す（共有プールには他のアプリのクライアントもいるため） |
| ソムリエの Runtime（`sommelier/agentcore/agentcore.json`） | JWT Authorizer の `discoveryUrl` を共通プールに、`allowedClients` を builder のクライアントだけに。アプリ内検証の `COGNITO_USER_POOL_ID` / `COGNITO_APP_CLIENT_ID` も同じ値に |
| 画面（`src/features/auth/`） | マネージドログインへのリダイレクトに置き換え。独自のサインイン・サインアップ・パスワード再設定・TOTP 入力・MFA 設定ダイアログは消した |

## 旧ユーザープール（`sakekasu-dev-auth`）を外す（2 段）

データの付け替え（下の「データの付け替え」）が済み、利用者（本人）が旧プールを消してよいと判断したので外す。
プールは RETAIN で、スタックは cdkd の管理下にある。プールを消すと旧 sub は二度と戻らないので、
共通ログインへの切り替えを revert して旧プールへ戻す道はここで閉じる。

外す順番は「読む側から参照を外す → 次のデプロイで読まれる側を外す」の 2 段。
監視スタック（`sakekasu-dev-monitoring`）が auth の Export（ユーザープール ID とカナリア用クライアント ID）を
`Fn::ImportValue` で読んでいたため。cdkd も CloudFormation と同じく、ほかのスタックの state に Import が
記録されているスタックは destroy させない（`StackHasActiveImportsError`）。

### 1 段目: 監視スタックから旧プールへの参照を外す

外したもの（どれも監視スタック。main へのマージで deploy が消す）:

| 何を | 名前 |
| --- | --- |
| カナリアの Lambda（ロールとインラインポリシーはマージの前に手で消す。下の手順） | `dev-sakekasu-sommelier-canary` |
| カナリアのスケジュール | `dev-sakekasu-sommelier-canary-schedule` |
| カナリアのアラーム 3 件 | `dev-sakekasu-sommelier-canary`・`dev-sakekasu-watcher-failure-sommelier-canary`・`dev-sakekasu-watcher-silent-sommelier-canary` |
| 新規登録通知の失敗アラーム | `dev-sakekasu-signup-notify-fail` |
| 出力 | `CanaryCredentialsSecretName` |

カナリアのロググループ（`/aws/lambda/dev-sakekasu-sommelier-canary`）は RETAIN なので、deploy では消えずに残る。
2 段目の手順で手で消す。

#### マージの前に、カナリアの IAM ロールを手で消す

**CI の cdkd ロールは IAM ロールを消せない。** cdkd はロールを消す前に `iam:ListInstanceProfilesForRole` を打つが、
`sakekasu-cdkd-deploy` にはこの権限が無い（足さない理由は [cdkd-migration.md](cdkd-migration.md) の
「取り込み済みリソースへの初回更新は改名になる」）。ロールの名前が `role/sakekasu-*` に入っていても同じで、
このまま 1 段目をマージすると、deploy がカナリアのロールの削除で落ちる。

cdkd はロールを消す前に `GetRole` で有無を見て、無ければ消したものとして state から外す。
そこで、ロールだけ先に自分の権限で消しておく。カナリアのスケジュールは止めてあるので、Lambda からロールが
消えても何も起きない。

```bash
export AWS_PROFILE=sakekasu-builder AWS_REGION=ap-northeast-1

# 1. カナリアの Lambda が使っているロールの名前を引く
role_arn="$(aws lambda get-function-configuration --function-name dev-sakekasu-sommelier-canary \
  --query Role --output text)"
role="${role_arn##*/}"
echo "$role"   # sakekasu-dev-monitoring-SommelierCanary… で始まること

# 2. 付いているポリシーを外してから消す
for arn in $(aws iam list-attached-role-policies --role-name "$role" \
    --query 'AttachedPolicies[].PolicyArn' --output text); do
  aws iam detach-role-policy --role-name "$role" --policy-arn "$arn"
done
for name in $(aws iam list-role-policies --role-name "$role" --query 'PolicyNames[]' --output text); do
  aws iam delete-role-policy --role-name "$role" --policy-name "$name"
done
aws iam delete-role --role-name "$role"

# 3. 消えたことを確かめる（NoSuchEntity になること）
aws iam get-role --role-name "$role"
```

インラインポリシー（`AWS::IAM::Policy`）も 2 で一緒に消える。cdkd がそれを消すときは
`NoSuchEntity` を「消えている」として扱うので、deploy は止まらない。

ここまで済ませたら 1 段目をマージする。deploy（`deploy.yml`）が通ったら、監視スタックの state に
旧プールの Import が残っていないことを確かめる。残っていると、2 段目の `cdkd state destroy` が
`StackHasActiveImportsError` で止まる。

```bash
cd infra
npx cdkd state show sakekasu-dev-monitoring --json \
  | jq '[.state.imports // [] | .. | strings | select(startswith("sakekasu-dev-auth:"))]'
# [] になること
```

auth スタックのテンプレートは 1 文字も変えていない。`infra/bin/app.ts` で `exportValue` を使い、
監視スタックが読んでいた 2 つの Export を同じ名前のまま出し続けている。deploy は auth → api → monitoring の順に
走るので、auth のほうで先に Export を消すと、デプロイ済みの監視スタックがまだ読んでいる Export を消す形になる。
Export を消すのは auth をアプリから外す 2 段目に回した。

### 2 段目: auth スタックをアプリから外す

コードから外したもの:

- `AuthStack`（`infra/lib/auth-stack.ts` とテスト）、新規登録通知の Lambda（`infra/lambda/signup-notifier`）、
  `infra/bin/app.ts` の `exportValue` と api → auth の依存
- `infra/scripts/migrate-to-cdkd.sh` の auth と、auth にしか無かった UserPoolClient の識別子の手当て
- `infra/lib/cdkd-policies.ts` の Cognito の作成・更新・削除の権限（読み取りは残した。理由はコメント）。
  効くのは `sakekasu-github-oidc` を手でデプロイしたとき（下の手順 10）
- データの付け替えのスクリプト（`infra/scripts/migrate_owner_sub.py` とテスト、`test.yml` の `scripts` ジョブ）。
  付け替えは済み、旧プールを消すと逆向きに流す相手も無くなる。中身は git の履歴にある

**マージしても AWS 側は何も変わらない。** `cdkd deploy --all` が扱うのは合成したスタックだけで、
state にしか無いスタックには触らない（0.291.31。health-global を外したときと同じ。
[cdkd-migration.md](cdkd-migration.md) の「health-global を外した」）。旧プールもトリガーの Lambda も残るので、
マージと deploy が通ったあとに手で消す。CI に入れないのも health-global と同じ理由
（CI の cdkd ロールは IAM ロールを消せない。一度きりの破壊的な手順を deploy に置かない）。

#### `cdkd state destroy` で何が消えて何が残るか

`state destroy` は、state に記録した `DeletionPolicy` が `Retain` のリソースを消さずに state から外すだけにする
（0.291.31 の `runDestroyForStack`）。合成結果では次のとおり。実際の値は手順 1 で state から読んで確かめる。

| 論理 ID | 型 | 名前 | `state destroy` で |
| --- | --- | --- | --- |
| `UserPool6BA7E5F2` | `AWS::Cognito::UserPool` | `dev-sakekasu-userpool`（`ap-northeast-1_eZOfInCT4`） | **残る**（Retain）。手順 5 で消す |
| `UserPoolUserPoolClient40176907` | `AWS::Cognito::UserPoolClient` | `dev-sakekasu-client` | 消える |
| `UserPoolCanaryUserPoolClientD962CFED` | `AWS::Cognito::UserPoolClient` | `dev-sakekasu-canary-client` | 消える |
| `UserPoolPostConfirmationCognito0E6001F8` | `AWS::Lambda::Permission` | トリガーの呼び出し許可 | 消える |
| `SignupNotifierFunctionF191E88B` | `AWS::Lambda::Function` | `dev-sakekasu-signup-notifier` | 消える |
| `SignupNotifierFunctionServiceRole180FCFE5` | `AWS::IAM::Role` | `sakekasu-dev-auth-SignupNotifierFunctionServiceRole180FCFE5` | 消える（自分の権限で打つので消せる） |
| `SignupNotifierFunctionServiceRoleDefaultPolicy5E860FA5` | `AWS::IAM::Policy` | 上のロールのインラインポリシー | 消える |
| `SignupNotifierLogGroupF4C03A83` | `AWS::Logs::LogGroup` | `/aws/lambda/dev-sakekasu-signup-notifier` | **残る**（Retain）。手順 6 で消す |
| `SignupNotifyFailMetricFilter1ADE9132` | `AWS::Logs::MetricFilter` | `SignupNotifyFailCount` | 消える |

- ユーザープールの削除保護（`DeletionProtection`）は CDK で指定しておらず、既定の `INACTIVE` のはず。手順 2 で確かめる
- ドメイン（Hosted UI のプレフィックスやカスタムドメイン）はテンプレートに無い。手で付けていないことを手順 2 で確かめる。
  付いているとプールを消せない
- カナリアの監視ユーザー（`canary@…`）と本人の旧アカウントは、プールと一緒に消える
- `--remove-protection` は削除保護を外すだけで、Retain のリソースは消さない。ここでは要らない

#### 手順（Mac から。2 段目のマージ後の deploy が通ってから）

**マージより前に打たない。** main のアプリにまだ auth が入っている間に消すと、次の deploy が作り直す
（ユーザープールは名前が重複できるので、空の新しいプールが黙ってできる）。

**`CDKD_ROLE_ARN` は渡さない。** 自分の権限（`sakekasu-builder`）で直接打つ。

```bash
cd infra
export AWS_PROFILE=sakekasu-builder AWS_REGION=ap-northeast-1

# 0. 1 段目が効いていること。監視スタックの state に旧プールの Import が無いこと（[] になる）
npx cdkd state show sakekasu-dev-monitoring --json \
  | jq '[.state.imports // [] | .. | strings | select(startswith("sakekasu-dev-auth:"))]'

# 1. 消す対象と DeletionPolicy を確かめる。9 行出て、UserPool と LogGroup が Retain であること
npx cdkd state show sakekasu-dev-auth --json \
  | jq -r '.state.resources | to_entries[] | [.key, .value.resourceType, .value.physicalId, (.value.deletionPolicy // "-")] | @tsv'

# 2. プールの中身を確かめる。Name が dev-sakekasu-userpool、DeletionProtection が INACTIVE、
#    Domain と CustomDomain が null であること
aws cognito-idp describe-user-pool --user-pool-id ap-northeast-1_eZOfInCT4 \
  --query 'UserPool.{Name:Name,DeletionProtection:DeletionProtection,Domain:Domain,CustomDomain:CustomDomain,Users:EstimatedNumberOfUsers}'

# 3. スタックを消す。リソースを消してから state も消す。確認を訊かれたら y
npx cdkd state destroy sakekasu-dev-auth --stack-region ap-northeast-1

# 4. state から消えたことを確かめる（sakekasu-dev-auth が無いこと）
npx cdkd state list

# 5. 残ったユーザープールを消す。ここで旧 sub は二度と戻らなくなる
aws cognito-idp delete-user-pool --user-pool-id ap-northeast-1_eZOfInCT4
aws cognito-idp describe-user-pool --user-pool-id ap-northeast-1_eZOfInCT4   # ResourceNotFoundException

# 6. 残ったロググループを消す（新規登録通知と、1 段目で外したカナリアのもの）
aws logs delete-log-group --log-group-name /aws/lambda/dev-sakekasu-signup-notifier
aws logs delete-log-group --log-group-name /aws/lambda/dev-sakekasu-sommelier-canary
```

手順 2 で `Domain` か `CustomDomain` に値があったら、5 の前に
`aws cognito-idp delete-user-pool-domain --user-pool-id ap-northeast-1_eZOfInCT4 --domain <その値>` で外す。
`DeletionProtection` が `ACTIVE` だったら、5 の前に
`aws cognito-idp update-user-pool --user-pool-id ap-northeast-1_eZOfInCT4 --deletion-protection INACTIVE` で外す
（`update-user-pool` は渡さなかった設定を既定に戻すが、直後に消すので構わない）。

3 が途中で落ちたら state は残るので、原因を直してもう一度 3 を打てばよい。同じリソースで落ち続けるときに限り、
AWS 側を手で消してから `npx cdkd state orphan sakekasu-dev-auth --stack-region ap-northeast-1` で記録だけを外す。
UserPoolClient の削除で落ちたときは、5 でプールを消せばクライアントも一緒に消える。

#### ほかに残っているもの

どれも AWS 側を直接消す。順番は問わないが、上の手順の後に打つ。

```bash
export AWS_PROFILE=sakekasu-builder AWS_REGION=ap-northeast-1

# 7. 取り残されたロール。全スタックへのタグ付け（#245）で cdkd が新しい名前のロールを作ったときに
#    管理から外れたもの（cdkd-migration.md の「取り込み済みリソースへの初回更新は改名になる」）。
#    get-role が NoSuchEntity なら何もしなくてよい
role=sakekasu-dev-auth-SignupNotifierFunctionServiceRole-uF3uXTOrV5Pb
aws iam get-role --role-name "$role" --query 'Role.{Name:RoleName,LastUsed:RoleLastUsed}'
for arn in $(aws iam list-attached-role-policies --role-name "$role" \
    --query 'AttachedPolicies[].PolicyArn' --output text); do
  aws iam detach-role-policy --role-name "$role" --policy-arn "$arn"
done
for name in $(aws iam list-role-policies --role-name "$role" --query 'PolicyNames[]' --output text); do
  aws iam delete-role-policy --role-name "$role" --policy-name "$name"
done
aws iam delete-role --role-name "$role"

# 8. カナリアの監視ユーザーの認証情報（Secrets Manager）。まず同じ置き場に他に何があるかを見る
aws secretsmanager list-secrets --filters Key=name,Values=dev-sakekasu/monitoring/ \
  --query 'SecretList[].{Name:Name,LastAccessed:LastAccessedDate}' --output table
aws secretsmanager delete-secret --secret-id dev-sakekasu/monitoring/canary-user \
  --recovery-window-in-days 7
```

8 は 7 日間は `aws secretsmanager restore-secret --secret-id dev-sakekasu/monitoring/canary-user` で戻せる。
一覧にカナリア用の別の秘密（以前の名前など）が出たら、それも同じように消す。Slack の Webhook URL は
SSM パラメータ（`/dev-sakekasu/monitoring/slack-webhook-url`）なので、この一覧には出ない。消さない。

#### 旧 sub の下の画像を消す

付け替えでは旧 sub（`e7d42a18-6071-70f4-dbe2-8f67cb896483`）の下の画像を新 sub（`37c47a88-30a1-7052-0fe7-98ec1af2d32e`）の下へ写し、旧キーは残した。
旧プールを消すと旧 sub で開ける人はいなくなるので、消してよい。先に、写し漏れが無いことを確かめる。

```bash
cd "$(mktemp -d)"   # キーの一覧を書き出す作業場所
export AWS_PROFILE=sakekasu-builder AWS_REGION=ap-northeast-1
bucket=dev-sakekasu-images
old=e7d42a18-6071-70f4-dbe2-8f67cb896483
new=37c47a88-30a1-7052-0fe7-98ec1af2d32e

# 9-1. 旧 sub と新 sub の下のキーを、sub を外した形で並べる。
#      {sub}/tmp/ は 1 日で消える一時領域で写していないので、旧の側から外す
aws s3api list-objects-v2 --bucket "$bucket" --prefix "$old/" --query 'Contents[].Key' --output text \
  | tr '\t' '\n' | grep -v '^None$' | grep -v "^$old/tmp/" | sed "s|^$old/||" | sort > old-keys.txt
aws s3api list-objects-v2 --bucket "$bucket" --prefix "$new/" --query 'Contents[].Key' --output text \
  | tr '\t' '\n' | grep -v '^None$' | sed "s|^$new/||" | sort > new-keys.txt

# 9-2. 件数。旧は付け替えのときの 648 件、新はそれ以上（付け替えの後に足した画像のぶん）であること
wc -l old-keys.txt new-keys.txt

# 9-3. 旧にあって新に無いキー。0 であること。0 でなければ消さずに止まる
comm -23 old-keys.txt new-keys.txt | wc -l

# 9-4. 消す。まず --dryrun で対象を見る（tmp/ の残りも含めて旧 sub の下を全部消す）
aws s3 rm "s3://$bucket/$old/" --recursive --dryrun | wc -l
aws s3 rm "s3://$bucket/$old/" --recursive

# 9-5. 消えたことを確かめる（0 になる）
aws s3api list-objects-v2 --bucket "$bucket" --prefix "$old/" --query 'KeyCount'
```

バケットはバージョニングが有効なので、`aws s3 rm` は削除マーカーを置くだけで、旧版はそのまま残る
（一時領域のライフサイクルルールはタグの付いたものしか見ないので、ここで消した旧版は期限で消えない）。
間違えて消したものがあっても旧版から戻せる。旧 sub の痕跡を容量ごと消したいときは、落ち着いてから旧版と
削除マーカーも消す。こちらは戻せない。

```bash
# 9-6.（任意・戻せない）旧 sub の下の旧版と削除マーカーを消す
aws s3api list-object-versions --bucket "$bucket" --prefix "$old/" \
  --query '[Versions || `[]`, DeleteMarkers || `[]`][][].[Key, VersionId]' --output text \
  | while IFS=$'\t' read -r key version; do
      aws s3api delete-object --bucket "$bucket" --key "$key" --version-id "$version" >/dev/null
    done
aws s3api list-object-versions --bucket "$bucket" --prefix "$old/" \
  --query '{Versions: length(Versions || `[]`), DeleteMarkers: length(DeleteMarkers || `[]`)}'   # どちらも 0
```

#### `sakekasu-github-oidc` を更新する（任意）

```bash
# 10. cdkd のデプロイロールから Cognito の作成・更新・削除の権限を外す。
#     README の「OIDC 連携の初回セットアップ」と同じく、このスタックだけは手でデプロイする
cd infra
AWS_PROFILE=sakekasu-builder npx cdk diff sakekasu-github-oidc -c github-oidc=true
AWS_PROFILE=sakekasu-builder npx cdk deploy sakekasu-github-oidc -c github-oidc=true
```

打たなくても困らない。デプロイ済みのロールが広いままになるだけで、アプリのデプロイは通る。
diff に `ManageCognitoUserPools` の削除と `ReadCognitoUserPools` の追加以外が出たら、デプロイせずに止まる。

## カナリア（ソムリエとの実会話の監視）は消した

カナリアは監視用ユーザーでパスワードを使って直接サインインし（`ADMIN_USER_PASSWORD_AUTH`）、
ソムリエに短い相談を投げていた。共通ログインではこれができない。

- builder 用クライアントは `authFlows` が空で、パスワードによる直接の認証を受け付けない
- 共通プールは MFA 必須なので、パスワードだけではトークンが出ない
- ソムリエの Runtime の JWT Authorizer が見られるプールは 1 つだけ（`discoveryUrl`）。
  共通プールに切り替えると、旧プールでサインインしたカナリアのトークンは必ず 401/403 になる

共通ログインへ移ったときはいったん止め（スケジュールを無効にし、アラームの通知を切る）、
旧プールを外す 1 段目でコード（`infra/lambda/sommelier-canary`）ごと消した。止めたまま残すと、
旧プールのユーザーと Export を読み続けるので、旧プールを外せない。

ソムリエの外形監視（認証なしで叩いて 401/403 が返ることを見る）と、認証拒否・システムエラーの
アラームは残っている。無くなったのは「実際に会話できるか」の確認だけ。

作り直すなら、共通ログイン側（sakekasu-integrated_environment）の変更が要る。このリポジトリだけでは直せない。選択肢:

1. **共通プールにカナリア用のクライアントを足す**（`ADMIN_USER_PASSWORD_AUTH` のみ。ブラウザ向けとは分ける）。
   MFA 必須なので、カナリアは `SOFTWARE_TOKEN_MFA` のチャレンジに TOTP コードで答える必要がある。
   監視ユーザーの TOTP の秘密鍵を Secrets Manager に置き、Lambda でコードを計算して `AdminRespondToAuthChallenge` を返す。
   ソムリエの `allowedClients` と `COGNITO_APP_CLIENT_ID` にそのクライアントを足す（以前と同じ 2 か所）
2. **M2M（client credentials）のクライアントを足す**。ユーザーも MFA も要らないが、トークンに利用者の sub が無い
   （sub がクライアント ID になる）。ソムリエ側で「記録を持たない利用者」として扱えるか確かめる必要があり、
   M2M のトークン発行は課金対象。リソースサーバーとカスタムスコープも要る

以前の実装（Lambda、アラーム、テスト）は git の履歴にある。1 段目の PR を revert するのではなく、
選んだ方式に合わせて書き直す。

## データの付け替え（旧 sub → 新 sub）

同じ人でも、ユーザープールが変わると sub が変わる。このアプリは sub で持ち主を見分けているので、
付け替えるまでこれまでの記録と画像は見えない（新しいアカウントとして空の状態から始まる）。

sub を使っている場所と扱い:

| 場所 | 中身 | 扱い |
| --- | --- | --- |
| DynamoDB `dev-sakekasu-purchase-records` / `dev-sakekasu-drinking-records` の `owner` | 持ち主の sub。GSI `owner-index` のパーティションキー | スクリプトで書き換える |
| 同じ項目の `imageKey` / `imageKeys` | `{sub}/{種別}/{recordId}/{ファイル名}` | スクリプトで先頭の sub を書き換える |
| S3 `dev-sakekasu-images` の `{sub}/` 以下 | 画像とサムネイル（`thumb_*`） | スクリプトで新しいキーへコピーする（旧キーは残す）。`{sub}/tmp/` は 1 日で消える一時領域なので写さない |
| ソムリエの AgentCore Memory | 好みの記憶と会話の続き（actorId が sub） | 付け替えない。新しい利用者として一から貯め直しになる |
| ブラウザの localStorage | 相談の表示用の写しと絞り込み条件（キーに sub を含む） | 付け替えない。端末側の表示キャッシュなので捨ててよい |

Identity Pool（cognito-identity）は使っていない。identityId や `cognito:username` をキーにしたデータも無い。

DynamoDB の主キーは `id` だけで、`owner` は通常の属性。だから「新しいキーで写しを作る」のではなく、
同じ項目の `owner` を書き換えた。写しを作る方式にしなかったのは、飲酒記録の `purchaseRecordId` が
購入記録の `id` を指していて、id が変わると在庫との紐づけが切れるため。

### 結果

付け替えは済んだ。スクリプト（`infra/scripts/migrate_owner_sub.py`）を Mac から管理者権限で流し、

- S3: 旧 sub（`e7d42a18-6071-70f4-dbe2-8f67cb896483/`）の下の 648 件を、新 sub（`37c47a88-30a1-7052-0fe7-98ec1af2d32e/`）の下へ写した。旧キーは残した
- DynamoDB: 2 つのテーブルの `owner` と `imageKey` / `imageKeys` を新 sub に書き換えた

スクリプトとテストは、旧プールを外す 2 段目で消した（git の履歴にある）。旧プールを消したあとは、
旧 sub へ戻す先が無いため。書き換え前の記録が要るときは、テーブルの PITR（35 日）で書き換え前の時点に戻す。
旧キーの画像の片付けは、上の「旧 sub の下の画像を消す」。
