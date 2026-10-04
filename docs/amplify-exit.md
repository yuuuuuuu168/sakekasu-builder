# Amplify をやめて CDK 側へ寄せるかの検討

> **2026-10-04 に移行した。** builder は `sake.sakekasu-builder.com` で S3 + CloudFront（CDK）から配り、
> apex と www は sake. へ転送している。Amplify アプリは削除済み。手順と記録は [sake-subdomain.md](sake-subdomain.md)。
> 以下は移行前の検討の記録として残す。

cdkd 移行（[#150](https://github.com/yuuuuuuu168/sakekasu-builder/issues/150)）の流れで「Amplify を全面的にやめる」案が出たので、可否を調べた。結論は「急いでやる理由は無い。ただし移行しないなら、コンソールにしか無い設定をこの文書に書き出しておく」。

AWS 側の実測は 2026-08-28 に読み取り専用プロファイルで取ったもの。

## 検討の出発点だった前提は2つとも成り立っていない

### Amplify は止まっていない

「今ストップしている Amplify」という前提で検討を始めたが、実際には動いていた。`main` ブランチの自動ビルドは有効で、直近のビルドは 2026-08-28 03:19 UTC に PR #208 のマージを拾って成功している。8月24日以降だけで6本走っていて、失敗は無い。

紛らわしいのは、アプリ側の `enableBranchAutoBuild` が `false` になっていること。これは新しく接続したブランチに自動ビルドを付けるかどうかの既定値で、既存ブランチの挙動には効かない。実際に効くのはブランチ側の設定のほうで、`main` は `enableAutoBuild: true`。コンソールの表示だけ見て止まっていると読んだのだとしたら、見る場所が違う。

### 費用がかかっていない

Cost Explorer で 2026年2月から今日までを月別に見たが、AWS Amplify の請求額は全月ゼロだった（数値としては小数点以下8桁の負の値が数か月あるが、これはクレジットの調整で実質ゼロ）。

8月の使用量の内訳は次のとおり。

| 項目 | 8月の使用量 |
| --- | --- |
| ビルド時間 | 145.9 分 |
| データ保存 | 3.5 MB |
| データ転送 | 101 MB |

無料枠に収まっている。仮に無料枠が切れても、この使用量ならビルドが月1.5ドル弱、転送が2セント程度で、合計しても月2ドルに届かない。

つまり移行によるコスト削減はゼロ。CloudFront に移しても無料枠の中なので、どちらもゼロ対ゼロになる。

## このリポジトリで Amplify が担っているものは1つしかない

「Amplify をやめる」と言うとき、実体として3つの別物が混ざる。分けないと規模の見積もりを間違える。

| 呼ばれ方 | 実体 | いまの状態 |
| --- | --- | --- |
| Amplify Hosting | フロントの配信。ビルド、CDN、TLS 証明書、`sakekasu-builder.com` の紐付け | 使っている。やめる対象はここだけ |
| `amplify_outputs.json` | 設定ファイル。AppSync の URL と Cognito の ID が入っているだけ | `infra/scripts/generate-outputs.ts` が CDK の出力から作っている。Amplify は関与していない |
| `aws-amplify` パッケージ | Cognito と AppSync を叩くクライアントライブラリ | 使っている。ホスティングとは無関係で、やめる必要がない |

Amplify のバックエンド（Gen1 の `amplify/backend`、Gen2 の `defineBackend`）はこのリポジトリに存在しない。AppSync も DynamoDB も Cognito も S3 も、最初から `infra/lib/` の CDK が作っている。バックエンドの脱 Amplify は済んでいる。

残っているのはフロントの配信だけで、これは CDK にもリポジトリにも載っていない。`amplify.yml` が無いので、ビルド設定もリライト規則もセキュリティヘッダもカスタムドメインの紐付けも、全部 Amplify コンソールの中にある。**このリポジトリで唯一 IaC の外にある設定がここ。** 移行を考えるなら、動機はコストでも速度でもなくこれになる。

なお Amplify Hosting の配信そのものは CloudFront が担っている（`d158s516cgxf7d.cloudfront.net`）。移行しても CDN が変わるわけではなく、誰がその CloudFront を持つかが変わるだけ。

## コンソールにしか無かった設定

移行するにしてもしないにしても、ここは書き出しておく価値がある。以下は今回 API から読み出した現物。

### ビルド仕様

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci --cache .npm --prefer-offline
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
  cache:
    paths:
      - .npm/**/*
```

ビルドマシンは `STANDARD_8GB`、キャッシュ設定は `AMPLIFY_MANAGED_NO_COOKIES`。

### リライト規則

SPA 用に1本だけ。`/<*>` を `/index.html` へ、ステータス `404-200` で返す。CloudFront へ移すなら、カスタムエラーレスポンスで 403 と 404 を `/index.html` の 200 に読み替える形になる。

### セキュリティヘッダ

全パス（`**/*`）に対して7種類。移行でいちばん気を遣うのはここ。

| ヘッダ | 値 |
| --- | --- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `X-XSS-Protection` | `1; mode=block` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https:` |

### ドメインと証明書

`sakekasu-builder.com` に Amplify 管理（`AMPLIFY_MANAGED`）の証明書が付いている。apex と `www` の両方が `d158s516cgxf7d.cloudfront.net` へ CNAME で向いていて、`www` は検証済み、apex は `verified: false` のまま。外形監視は apex を叩いて 200 を得ているので配信自体は成立しているが、この未検証の状態が何を意味するかは移行前に一度見ておいたほうがいい。

移行すると証明書は自分の ACM 証明書（us-east-1）に置き換わる。Amplify 管理の証明書は持ち出せない。

## cdkd の高速化は、この移行の理由にならない

cdkd が速いのは、CloudFormation のスタック操作とイベントのポーリングを飛ばして SDK を直接叩くから。速度の恩恵を受けるのは CloudFormation を経由しているものに限られる。

Amplify Hosting は CloudFormation を経由していない。フロントのデプロイは Amplify 自身のビルドサービスが走らせていて、`cdk deploy` の対象ですらない。だから cdkd がどれだけ速くなっても、フロントのデプロイ時間は1秒も変わらない。

移行先の S3 + CloudFront にしたところで、配信物の更新はバケットへの同期で済むので、これも CloudFormation を通らない。CloudFront のディストリビューション自体を作り直すときはエッジへの伝播で数分かかるが、その待ち時間は cdkd でも CloudFormation でも同じ。AWS 側の都合なので CLI を替えても縮まない。

「界隈で Amplify がいまいちという風潮」のほうも、多くは Amplify Gen2 のバックエンド定義（`defineBackend` と `a.schema()`）の使い勝手を指している。このリポジトリはそこを最初から使っていないので、その批判はそのまま当てはまらない。

## デリバリー速度

いまのフロントのビルドは、直近6本の実測で1分40秒から2分10秒の範囲に収まっている。移行後は GitHub Actions で依存を入れてビルドして S3 へ同期し、CloudFront を無効化する流れになるが、同じような時間になると見ている。速くはならない。

速度そのものより、経路が2系統から1系統になることのほうが効く。いまはフロントとバックエンドで「デプロイの成否をどこで見るか」が違っていて、片方は Actions のログ、片方は Amplify のコンソール。ここが揃うのは、地味だが毎回効く。

失うものもある。Amplify の PR プレビュー（ブランチごとに一時 URL が立つやつ）は消える。ただし今回確認したかぎりブランチは `main` の1本だけで、`enableAutoBranchCreation` も無効なので、そもそも使っていない。失うものは実質無い。

## 移行にかかる手間と、着手のタイミング

半日から1日ぐらいの作業量と見ている。内訳は、CDK スタックの追加（S3 バケット、CloudFront、OAC、ACM 証明書、レスポンスヘッダポリシー）、GitHub Actions のワークフロー追加、cdkd の両ロールへの権限追加、証明書の DNS 検証、ドメインの切り替え、戻し手順の確認。

問題は金額でも工数でもなく、着手するタイミング。

**cdkd 移行が手順6で止まっている状態でリソースを増やすと、確認をやり直すことになる。** [cdkd-migration.md](cdkd-migration.md) の手順5で「4スタックすべて未対応の型もプロパティも無し」という結果を取ってあるが、CloudFront と ACM が入ればこの確認は取り直しになる。同じ文書が「手順7を始めたら手順9のマージまで `infra/**` を main に入れない」とも書いていて、その窓に新規スタックのマージをぶつけるのは避けたい。

cdkd 側の対応状況は、おおむね問題ない。[supported-resources.md](https://github.com/go-to-k/cdkd/blob/main/docs/supported-resources.md) を見ると `AWS::CloudFront::Distribution`、`AWS::CloudFront::OriginAccessControl`、`AWS::S3::Bucket`、`AWS::S3::BucketPolicy`、`AWS::CertificateManager::Certificate`、`AWS::Route53::HostedZone`、`AWS::Route53::RecordSet` はいずれも SDK Provider 対応済み。

ただし `ResponseHeadersPolicy` は一覧に無い。上のセキュリティヘッダ7種を CloudFront で再現するのに要るのがまさにこの型で、Cloud Control API へのフォールバックになる。cdkd-migration.md が Application Signals の SLO について書いているのと同じで、Cloud Control 経由でもサービス側の権限は別途要るため、デプロイロールと diff ロールの両方に `cloudfront:CreateResponseHeadersPolicy` などを足すことになる。

## やらないほうがいいこと

`aws-amplify` パッケージの置き換えは、この検討に含めない。

このパッケージは `src/` の30ファイル近くで使っていて、中身はセッション管理、AppSync のクライアント、S3 の署名付き URL 取得まで及ぶ（書いた当時はサインアップ・サインイン・MFA の TOTP 登録・パスワードリセットも担っていたが、共通ログインへの移行でマネージドログインへのリダイレクトに置き換わった。[shared-login.md](shared-login.md)）。剥がすなら Cognito の SRP 認証を自前で組むか `amazon-cognito-identity-js` に移ることになって、`src/__mocks__/aws-amplify-*.ts` を含むテストも全部書き直しになる。

そこまでやって得られるのはバンドルサイズが少し減ることぐらいで、デリバリー速度もコストも改善しない。認証は壊すと利用者が締め出される場所なので、割に合わない。ホスティングをやめてもこのライブラリはそのまま動く。設定ファイルを読んで Cognito と AppSync を叩いているだけで、Amplify Hosting の上で動いている必要はない。

## 移行するとしたら

順番だけ整理しておく。着手は cdkd の手順9が終わってから。

1. CDK に配信スタックを足す。S3 バケットはパブリックアクセスを閉じたまま、CloudFront から OAC で読む。証明書は CloudFront の制約で us-east-1 に置く（以前 `sakekasu-dev-health-global` を置いていたリージョンで、cdkd の us-east-1 のアセット置き場は [cdkd-migration.md](cdkd-migration.md) の手順4 で作ってある）
2. セキュリティヘッダをレスポンスヘッダポリシーへ移す。上の表と一字一句突き合わせる。CSP を取りこぼしても画面は普通に出るので、抜けても気づけない
3. SPA のリライトを、403 と 404 を `/index.html` の 200 に読み替えるカスタムエラーレスポンスで置き換える
4. GitHub Actions にフロントのデプロイを足す。`paths` は `src/**` と設定ファイル
5. Amplify とは別の一時ドメインで通しで確認する。ヘッダは実際にレスポンスを取って7種類そろっているかを見る
6. DNS を CloudFront へ向ける。ここが不可逆に近い唯一の地点。戻すのも DNS を戻すだけだが、TTL の分だけ時間がかかる
7. しばらく様子を見てから Amplify アプリを削除する

**フロントの配信物を CDK の `BucketDeployment` で置かない。** あれは `Custom::CDKBucketDeployment` という Lambda 製のカスタムリソースを作る。[#129](https://github.com/yuuuuuuu168/sakekasu-builder/issues/129) で `Custom::LogRetention` を6個消したのは、CloudFormation がカスタムリソースを IMPORT できず cdkd から戻せなくなるためだった。同じ性質のものをフロント側から持ち込むと、せっかく確保した退路が塞がる。ビルド成果物は Actions から CLI でバケットへ同期する形にする。

外形監視は変更が要らない。`infra/bin/app.ts` の `siteUrl` は `https://sakekasu-builder.com` で、監視しているのはドメインであって Amplify の URL ではない。DNS の向き先が変わるだけなので、`monitoring-stack.ts` の設定はそのまま通る。

ついでに片付くものとして、`infra/lib/api-stack.ts` の S3 CORS 許可オリジンから `https://*.amplifyapp.com` を消せる。ワイルドカードのサブドメインを許可している行なので、消せるなら消したい。

## 結論

急いでやる理由は無い。

出発点だった2つの前提はどちらも成り立っていなかった。Amplify は止まっておらず今朝もデプロイに成功しているし、費用は今日までゼロで、移行しても削減額はゼロのまま。「cdkd が速くなったから」という筋も、Amplify Hosting が CloudFormation を通らない以上つながらない。

残る動機は「フロントの配信設定だけが IaC の外にある」という一点だが、その中身はこの文書に書き出した。コンソールを開かないと現状が分からないという問題は、これでかなり薄まっている。設定を変えたらこの文書も直す、という運用にしておけば、移行しなくても当面は困らない。

移行するなら、cdkd を手順9まで閉じてから。進行中の移行に別の移行を重ねると、どちらの問題か切り分けられなくなる。そのときの最大の作業はセキュリティヘッダの移植で、CloudFront の配信設定そのものではない。
