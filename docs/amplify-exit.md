# Amplify をやめて CDK 側へ寄せるかの検討

cdkd 移行（[#150](https://github.com/yuuuuuuu168/sakekasu-builder/issues/150)）の流れで「Amplify を全面的にやめる」案が出たので、可否を調べた。結論は「やる価値はあるが、いま出ている理由は成り立っていない。cdkd 移行を閉じてから、別の理由で着手する」。

## まず、このリポジトリで Amplify が担っているものは1つしかない

「Amplify をやめる」と言うとき、実体として3つの別物が混ざる。分けないと規模の見積もりを間違える。

| 呼ばれ方 | 実体 | いまの状態 |
| --- | --- | --- |
| Amplify Hosting | フロントの配信。ビルド、CDN、TLS 証明書、`sakekasu-builder.com` の紐付け | 使っている。やめる対象はここだけ |
| `amplify_outputs.json` | 設定ファイル。AppSync の URL と Cognito の ID が入っているだけ | `infra/scripts/generate-outputs.ts` が CDK の出力から作っている。Amplify は関与していない |
| `aws-amplify` パッケージ | Cognito と AppSync を叩くクライアントライブラリ | 使っている。ホスティングとは無関係で、やめる必要がない |

Amplify のバックエンド（Gen1 の `amplify/backend`、Gen2 の `defineBackend`）はこのリポジトリに存在しない。AppSync も DynamoDB も Cognito も S3 も、最初から `infra/lib/` の CDK が作っている。つまりバックエンドの脱 Amplify は済んでいる。

残っているのはフロントの配信だけで、これは CDK にもリポジトリにも載っていない。`amplify.yml` が無いので、ビルド設定もリダイレクト設定もカスタムドメインの紐付けも、全部 Amplify コンソールの中にある。**このリポジトリで唯一 IaC の外にある設定がここ。** 移行を考えるなら、動機はコストでも速度でもなくこれだと思う。

## cdkd の高速化は、この移行の理由にならない

cdkd が速いのは、CloudFormation のスタック操作とイベントのポーリングを飛ばして SDK を直接叩くから。速度の恩恵を受けるのは CloudFormation を経由しているものに限られる。

Amplify Hosting は CloudFormation を経由していない。フロントのデプロイは Amplify 自身のビルドサービスが走らせていて、`cdk deploy` の対象ですらない。だから cdkd がどれだけ速くなっても、フロントのデプロイ時間は1秒も変わらない。

移行先の S3 + CloudFront にしたところで、配信物の更新はバケットへの同期で済むので、これも CloudFormation を通らない。CloudFront のディストリビューション自体を作り直すときはエッジへの伝播で数分かかるが、その待ち時間は cdkd でも CloudFormation でも同じ。AWS 側の都合なので CLI を替えても縮まない。

「界隈で Amplify がいまいちという風潮」のほうも、多くは Amplify Gen2 のバックエンド定義（`defineBackend` と `a.schema()`）の使い勝手を指している。このリポジトリはそこを最初から使っていないので、その批判はそのまま当てはまらない。

## デリバリー速度

いまのフロントのデプロイは、main へのマージを Amplify が拾って自前のビルドサービスで走らせている。バックエンドの GitHub Actions とは完全に別系統。

移行後は GitHub Actions に一本化されて、依存を入れてビルドして S3 へ同期し、CloudFront を無効化する流れになる。実測はしていないが、どちらも数分の範囲で、体感が変わるほどの差は出ないと見ている。

速度そのものより、経路が2系統から1系統になることのほうが効く。いまはフロントとバックエンドで「どこを見ればデプロイの成否が分かるか」が違っていて、失敗の通知先も別。片方は Actions のログ、片方は Amplify のコンソール。ここが揃うのは、地味だが毎回効く。

失うものもある。Amplify の PR プレビュー（ブランチごとに一時 URL が立つやつ）を使っているなら、それは消える。CloudFront で同じことをやるには自前で組む必要があって、そこそこ面倒くさい。使っていないなら失うものは無い。

## デリバリーコスト

### 運用にかかる料金

CloudFront には期限なしの無料枠があって、月1TB の転送と1000万リクエストまでは課金されない。無効化も月1000パスまで無料。このアプリのフロントは JS と CSS と画像で数MB、利用者も限られているので、移行後の配信費用は実質ゼロになると見ている。S3 の保存料も数十MB 分で、小数点以下の世界。

Amplify Hosting のほうは、ビルド時間とデータ転送量とストレージにそれぞれ単価がかかる。12か月の無料枠を過ぎているなら、転送は最初の1GB から課金される。

ただしこの差額は月に数ドルの規模で、移行を正当化するほどではない。実際にいくら払っているかは Cost Explorer を見ないと確定できない。AWS の読み取りプロファイルで確認しようとしたが、SSO の承認が下りていないので数字は入れていない。承認をもらえたら実額を追記する。

### 移行にかかる手間

半日から1日ぐらいの作業量と見ている。内訳は、CDK スタックの追加（S3 バケット、CloudFront、OAC、ACM 証明書、DNS レコード）、GitHub Actions のワークフロー追加、cdkd の両ロールへの権限追加、証明書の DNS 検証、ドメインの切り替え、戻し手順の確認。

問題は金額でも工数でもなく、着手するタイミング。

**cdkd 移行が手順6で止まっている状態でリソースを増やすと、確認をやり直すことになる。** [cdkd-migration.md](cdkd-migration.md) の手順5で「4スタックすべて未対応の型もプロパティも無し」という結果を取ってあるが、CloudFront と ACM と Route 53 が入ればこの確認は取り直しになる。同じ文書が「手順7を始めたら手順9のマージまで `infra/**` を main に入れない」とも書いていて、その窓に新規スタックのマージをぶつけるのは避けたい。

cdkd 側の対応状況自体は問題ない。[supported-resources.md](https://github.com/go-to-k/cdkd/blob/main/docs/supported-resources.md) を見ると、`AWS::CloudFront::Distribution`、`AWS::CloudFront::OriginAccessControl`、`AWS::S3::Bucket`、`AWS::S3::BucketPolicy`、`AWS::CertificateManager::Certificate`、`AWS::Route53::HostedZone`、`AWS::Route53::RecordSet` はいずれも SDK Provider で対応済み。一覧に無いのは `ResponseHeadersPolicy` と `CachePolicy` と CloudFront Function で、これらは Cloud Control API へ落ちる。落ちること自体は想定内だが、cdkd-migration.md が Application Signals の SLO で書いているのと同じで、Cloud Control 経由でもサービス側の権限は別途要る。デプロイロールと diff ロールの両方に足す。

## やらないほうがいいこと

`aws-amplify` パッケージの置き換えは、この検討に含めない。

このパッケージは `src/` の30ファイル近くで使っていて、中身はサインアップ、サインイン、MFA の TOTP 登録、パスワードリセット、セッション管理、AppSync のクライアント、S3 の署名付き URL 取得まで及ぶ。剥がすなら Cognito の SRP 認証を自前で組むか `amazon-cognito-identity-js` に移ることになって、`src/__mocks__/aws-amplify-*.ts` を含むテストも全部書き直しになる。

そこまでやって得られるのはバンドルサイズが少し減ることぐらいで、デリバリー速度もコストも改善しない。認証は壊すと利用者が締め出される場所なので、割に合わない。ホスティングをやめてもこのライブラリはそのまま動く。設定ファイルを読んで Cognito と AppSync を叩いているだけで、Amplify Hosting の上で動いている必要はない。

## 移行するとしたら

順番だけ整理しておく。着手は cdkd の手順9が終わってから。

1. Amplify コンソールの設定を控える。ビルドコマンド、出力ディレクトリ、リライトとリダイレクトの規則、環境変数、カスタムドメインの構成。`amplify.yml` が無いので、この情報はコンソールにしか無い
2. CDK に配信スタックを足す。S3 バケットはパブリックアクセスを閉じたまま、CloudFront から OAC で読む。証明書は CloudFront の制約で us-east-1 に置く（`sakekasu-dev-health-global` と同じリージョンなので、置き場所の前例はある）
3. GitHub Actions にフロントのデプロイを足す。`paths` は `src/**` と設定ファイル
4. Amplify とは別の一時ドメインで先に通しで確認する。DNS を切り替えるのは動作を見てから
5. DNS を CloudFront へ向ける。ここが不可逆に近い唯一の地点。戻すときも DNS を戻すだけだが、TTL の分だけ時間がかかる
6. しばらく様子を見てから Amplify アプリを削除する

**フロントの配信物を CDK の `BucketDeployment` で置かない。** あれは `Custom::CDKBucketDeployment` という Lambda 製のカスタムリソースを作る。[#129](https://github.com/yuuuuuuu168/sakekasu-builder/issues/129) で `Custom::LogRetention` を6個消したのは、CloudFormation がカスタムリソースを IMPORT できず cdkd から戻せなくなるためだった。同じ性質のものをフロント側から持ち込むと、せっかく確保した退路が塞がる。ビルド成果物は Actions から CLI でバケットへ同期する形にする。

なお外形監視は変更が要らない。`infra/bin/app.ts` の `siteUrl` は `https://sakekasu-builder.com` で、監視しているのはドメインであって Amplify の URL ではない。DNS の向き先が変わるだけなので、`monitoring-stack.ts` の設定はそのまま通る。

ついでに片付くものとして、`infra/lib/api-stack.ts` の S3 CORS 許可オリジンから `https://*.amplifyapp.com` を消せる。ワイルドカードのサブドメインを許可している行なので、消せるなら消したい。

## 結論

やる価値はある。理由は「フロントの配信設定だけが IaC の外に取り残されていて、コンソールを開かないと現状が分からない」こと。この一点。

出発点になった「cdkd が速くなったから Amplify をやめる」という筋は成り立っていない。Amplify Hosting は CloudFormation を通らないので、cdkd の速度改善の対象外。コスト削減も月数ドルの規模で、動いているものを触る理由としては弱い。

順番は、cdkd 移行を手順9まで閉じてから。進行中の移行に別の移行を重ねると、どちらの問題か切り分けられなくなる。

やらないという判断も同じくらい妥当で、その場合は Amplify コンソールの設定内容を `docs/` に書き出しておくだけでも、IaC の外にある問題はいくらか薄まる。

## 確認が要ること

「今ストップしている Amplify」が何を指すかで、この検討の前提が変わる。

自動ビルドを止めているだけなら、`main` の最新がフロントに出ていない状態が続いていることになる。移行時に壊すものは少ないが、その間に溜まった変更は移行後にまとめて世に出る。アプリごと止めていてサイトが落ちているなら、外形監視の frontend アラームが鳴り続けているはずで、移行は復旧を兼ねる。

AWS の読み取りプロファイルで Amplify アプリの状態と直近のビルド履歴、Cost Explorer の実額を見れば確定するが、SSO の承認が下りていないため未確認。
