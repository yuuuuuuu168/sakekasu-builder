# sake.sakekasu-builder.com への移行

builder だけがトップレベルのドメイン（`sakekasu-builder.com`）で動いていて、他の 3 アプリ
（kakeibo・learning・reinvent）はサブドメインで動いている。builder も
`sake.sakekasu-builder.com` に移し、あわせて配信を Amplify Hosting から CDK（S3 + CloudFront）へ
載せ替える。

## なぜ移すか

- apex を空ける。4 アプリの入口ページや転送に使える。いまは「サイト全体の名前」と
  「アプリの 1 つ」が同じドメインを取り合っている
- 他のアプリと同じ形にそろう。ゾーンの委任、証明書、CORS、ログインの戻り先、外形監視を
  同じ雛形で書ける
- 配信の設定を IaC に載せる。Amplify ではビルド設定・リライト・セキュリティヘッダ・
  ドメインがコンソールにしか無かった（[amplify-exit.md](amplify-exit.md)）
- ついでに CSP を締める。Amplify の CSP は `script-src 'unsafe-inline' 'unsafe-eval'` と
  `connect-src https:`（どこへでも）だった。新しい配信では `script-src 'self'` にし、
  通信先を実際に叩く先だけに絞った（[site-stack.ts](../infra/lib/site-stack.ts)）

データとログインには影響しない。共通ユーザープールの sub は変わらないので、DynamoDB と S3 の
記録はそのまま使える。トークンはオリジンごとにブラウザへ保存されるため、移った後に
1 回ログインし直すことになる。

## 構成

| スタック | リージョン | 合成される条件 | 中身 |
| --- | --- | --- | --- |
| `sakekasu-dev-site-dns` | ap-northeast-1 | context `siteZone` | `sake.sakekasu-builder.com` のゾーン（RETAIN） |
| `sakekasu-dev-site` | us-east-1 | `siteZone`、`siteHostedZoneId`、`siteCertificateArn` | 配信バケット、CloudFront（OAC）、セキュリティヘッダ、A / AAAA |

- 2 つに分けてあるのは、ゾーンを親から委任してもらう前に証明書を作ると、DNS 検証が
  通らないため（kakeibo で 45 分止めた）
- 証明書（us-east-1）は cdkd では作らず、コンソールで作って ARN を `siteCertificateArn` で渡す。
  cdkd は CDK が付ける DNS 検証の設定を ACM に渡せず、`ValidationDomain` が null だとして
  弾かれる（2026-10-04 に実際に落ちた。共通基盤の auth の証明書も同じ扱い）
- 配信スタックは us-east-1 に置く。CloudFront に付ける証明書がそこにしか置けないため
- 配信物は `deploy-site.yml` が `aws s3 sync` で置く。使うロールは
  `sakekasu-github-actions-site` で、配信バケットのオブジェクトを読み書きできるだけ。
  cdkd のロールにも CloudFront にも届かない
- キャッシュの無効化は打たない。`index.html` は `no-cache` で置き、`assets/` は
  ファイル名にハッシュが入るので、新しい版が別の名前で置かれる

## 手順

1〜5 は apex（Amplify）を一切触らない。途中で止めても今の画面は動き続ける。

### 1. OIDC スタックを手で更新する（人の作業）

cdkd のデプロイロールに、ゾーン・証明書・CloudFront・配信バケットを作る権限を足した。
あわせて配信用のロール `sakekasu-github-actions-site` を作る。このスタックは Actions の
デプロイ対象に入っていない（自分のロールを自動更新して締め出す事故を避けるため）。

**この PR をマージする前に**打つ。先にマージすると、deploy.yml がゾーンを作ろうとして
AccessDenied で落ちる。

```sh
cd infra
AWS_PROFILE=sakekasu-builder npx cdk diff sakekasu-github-oidc -c github-oidc=true
AWS_PROFILE=sakekasu-builder npx cdk deploy sakekasu-github-oidc -c github-oidc=true
```

差分は、cdkd のロールのポリシーへの追加と、ロール `sakekasu-github-actions-site` の追加だけのはず。

### 2. 共通ログインに戻り先を足す

sakekasu-integrated_environment の `infra/cdk.json` で、builder のクライアントの
`callbackUrls` / `logoutUrls` に `https://sake.sakekasu-builder.com/` を足す PR をマージする。
apex と www はまだ外さない。

### 3. この PR をマージする（ゾーンができる）

`cdk.json` に `siteZone` が入っているので、deploy.yml がゾーンだけを作る。
`siteHostedZoneId` がまだ無いので、配信スタックは合成されない。deploy-site.yml も何もしない。

ゾーン ID と NS を読む。

```sh
cd infra
AWS_PROFILE=sakekasu-builder npx cdkd state show sakekasu-dev-site-dns --json
```

### 4. 親のゾーンから委任する（人の作業、管理アカウント）

Organization の管理アカウント（<管理アカウント ID>）にある `sakekasu-builder.com` のゾーンに、
NS レコードを 1 つ入れる。

| 名前 | 種類 | 値 |
| --- | --- | --- |
| `sake.sakekasu-builder.com` | NS | 手順 3 の `NameServers` の 4 つ |

委任が効いたことを確かめる。4 つが返ってくればよい。

```sh
dig NS sake.sakekasu-builder.com +short
```

**ここを確かめずに手順 5 へ進まない。** 証明書の検証レコードが誰も引かないゾーンに入り、
ACM が検証待ちのまま止まる。

### 5. 証明書を作る（人の作業、アプリのアカウント）

アプリのアカウント（232791540685）のコンソールで、**リージョンを us-east-1（バージニア北部）に
切り替えてから** ACM を開く。

1. 「証明書をリクエスト」→「パブリック証明書」
2. ドメイン名は `sake.sakekasu-builder.com`、検証方法は DNS
3. 作った証明書を開き、「Route 53 でレコードを作成」を押す。同じアカウントの
   sake. のゾーンに検証用の CNAME が入る
4. 数分で状態が「発行済み」になる。ARN を控える

### 6. 配信スタックを作り、配信物を置く

`infra/cdk.json` に `"siteHostedZoneId": "<手順 3 のゾーン ID>"` と
`"siteCertificateArn": "<手順 5 の ARN>"` を足す PR をマージする。deploy.yml が
バケット・CloudFront・エイリアスを作る。CloudFront の展開に数分かかる。

デプロイが終わったら、Actions の画面から **deploy-site** を手で実行する（workflow_dispatch）。
初回は src/ に変更が無いので、自動では走らない。

確かめること:

- `https://sake.sakekasu-builder.com/` が開き、ログインして戻ってこられる
- 記録の一覧、画像の表示とアップロード、OCR、ソムリエのチャットが動く
- ブラウザの開発者ツールのコンソールに CSP の違反（`Refused to connect` など）が出ていない。
  CSP で止められても画面は普通に出るので、ここを見ないと気づけない
- ヘッダが付いている

```sh
curl -sI https://sake.sakekasu-builder.com/ | grep -iE 'strict-transport|content-security|x-frame|permissions-policy'
```

### 7. apex を sake. へ転送する（別の PR）

apex と www を、パスを保ったまま `https://sake.sakekasu-builder.com/` へ 301 で転送する。
ブックマークを救うため。

**apex の A レコードは消さない。** 共通ログインの独自ドメイン（`auth.sakekasu-builder.com`）は、
親のドメインに A レコードがあることを Cognito が求める
（sakekasu-integrated_environment の docs/identity.md）。転送用の CloudFront を apex に向ける形なら
これを満たしたままにできる。

やり方は 2 つある。

- 当面: Amplify のリダイレクト規則で apex と www を sake. へ 301 にする。
  インフラを足さずに済み、Amplify の証明書と A レコードもそのまま残る
- 最終形: 転送専用の CloudFront（CloudFront Functions で 301 を返すだけ）を CDK で作り、
  apex と www をそこへ向けて Amplify アプリを消す。apex の証明書と A レコードは親のゾーン
  （管理アカウント）側の手作業が要る。設計は別の PR で詰める

### 8. 片付け

転送に切り替えてしばらく様子を見てから、次を外す。

- 共通ログインの builder のクライアントから `https://sakekasu-builder.com/` と
  `https://www.sakekasu-builder.com/`
- 画像バケットの CORS（[api-stack.ts](../infra/lib/api-stack.ts)）から apex と `*.amplifyapp.com`
- 外形監視の対象を sake. に替える。sakekasu-integrated_environment の `healthChecks` の builder と、
  このリポジトリの `siteUrl`（monitoring-stack は外形監視を共通基盤と二重に持っているので、
  あわせて外すことを検討する）
- [amplify-exit.md](amplify-exit.md) に「移行した」と書き足す

## 戻すとき

手順 1〜6 は足すだけの変更なので、apex の画面には影響しない。sake. 側がおかしければ、
`siteHostedZoneId` を cdk.json から消せば配信スタックは合成されなくなる。ただし
`cdkd deploy --all` は合成されなかったスタックを消さないので、消すなら手で
`cdkd destroy sakekasu-dev-site` を打つ（バケットは RETAIN なので残る）。

手順 7 の後は、Amplify のリダイレクト規則を外せば apex は元の画面に戻る。
