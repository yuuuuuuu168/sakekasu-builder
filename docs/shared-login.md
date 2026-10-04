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
| 新規登録の Slack 通知 | 旧プールの Post Confirmation トリガー | 役目を終えた（共通プールにセルフサインアップが無い）。旧プールを外すときに一緒に外す |
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

1 段目のマージと deploy が済んでから。手順は 2 段目の PR で書く。

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
同じ項目の `owner` を書き換える。写しを作る方式にしないのは、飲酒記録の `purchaseRecordId` が
購入記録の `id` を指していて、id が変わると在庫との紐づけが切れるため。
書き換えなので旧項目の `owner` は残らないが、次の 2 つで戻せる。

- 旧 sub と新 sub を入れ替えてスクリプトを流す（画像は旧キーに残っているのでコピーは起きず、記録だけが戻る）
- テーブルの PITR（35 日）で、書き換え前の時点に戻す

スクリプトは `infra/scripts/migrate_owner_sub.py`。既定は dry-run で、件数と例を出すだけ。
`--apply` を付けたときだけ書き込む。

- 先に S3、次に DynamoDB（記録が指す先の画像を先に揃える）
- S3 は新しいキーにすでにあればスキップ。旧キーは消さない
- DynamoDB は条件付き。`owner` が旧 sub のままで、読んだあとに `updatedAt` が変わっていない項目だけを書き換える
- 何度流しても安全。途中で落ちたら、もう一度流せば続きから進む

### 手順

スクリプトは Mac から、管理者権限のプロファイル（`sakekasu-builder`）で流す。
クラウドセッションの読み取り専用プロファイル（`verify`）では DynamoDB と S3 の中身も Cognito のユーザーも読めないので流せない。

1. この変更の PR をマージする。`deploy.yml`（infra）と `deploy-sommelier.yml`（ソムリエ）が走り、
   画面は Amplify Hosting が出し直す。3 つとも終わるまで待つ
2. `https://sakekasu-builder.com/` を開き、「サインイン」から共通ログインでログインする。
   ユーザーがまだ無ければ、共通ログイン側で先に作る（sakekasu-integrated_environment の `docs/identity.md`）。
   この時点では記録は空に見える
3. 旧 sub を調べる（旧プール）

   ```bash
   export AWS_PROFILE=sakekasu-builder
   aws cognito-idp list-users --region ap-northeast-1 \
     --user-pool-id <旧プールの ID（sakekasu-dev-auth の UserPoolId 出力）> \
     --query 'Users[].{user:Username, sub:Attributes[?Name==`sub`]|[0].Value, email:Attributes[?Name==`email`]|[0].Value}' \
     --output table
   ```

4. 新 sub を調べる（共通プール）

   ```bash
   aws cognito-idp list-users --region ap-northeast-1 \
     --user-pool-id <infra/cdk.json の sharedAuth.userPoolId> \
     --query 'Users[].{user:Username, sub:Attributes[?Name==`sub`]|[0].Value, email:Attributes[?Name==`email`]|[0].Value}' \
     --output table
   ```

5. dry-run で件数と例を確かめる

   ```bash
   uv run --with boto3 python infra/scripts/migrate_owner_sub.py \
     --old-sub <旧 sub> --new-sub <新 sub> \
     --purchase-table dev-sakekasu-purchase-records \
     --drinking-table dev-sakekasu-drinking-records \
     --bucket dev-sakekasu-images
   ```

   「旧 sub の記録」の件数が画面で見ていた記録の数と合っているか、「旧 sub で始まらない画像キー」の
   注意が出ていないかを見る

6. 書き込む

   ```bash
   uv run --with boto3 python infra/scripts/migrate_owner_sub.py \
     --old-sub <旧 sub> --new-sub <新 sub> \
     --purchase-table dev-sakekasu-purchase-records \
     --drinking-table dev-sakekasu-drinking-records \
     --bucket dev-sakekasu-images --apply
   ```

   「条件で見送った」が 1 件以上なら、画面で触っていないことを確かめてもう一度流し、0 件になるのを見る

7. 画面を読み込み直し、記録と画像（一覧のサムネイル、詳細の原画）が出ること、
   画像の追加と記録の削除ができることを確かめる

旧キーの画像は残る。消すのは、旧プールを外す別 PR が落ち着いてからでよい
（`infra/scripts/cleanup-orphan-images.py` は「どの記録からも参照されない画像」を消すので、
付け替えの後に流せば旧 sub の下の画像がまとめて対象になる。中身を `--dry-run` で必ず確かめる）。

スクリプトのテストは `uv run --with boto3 --with pytest pytest infra/scripts/tests`
（AWS へは出ない。PR ごとに `test.yml` の `scripts` ジョブが走らせる）。
