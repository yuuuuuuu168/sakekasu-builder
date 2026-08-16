# Claude Code on the web での開発（外出先開発環境）

iPhone のブラウザ／Claude アプリからタスクを投げ、「タスク指示 → PR 確認 → マージ → 自動デプロイ」を Mac なしで完結させるための設定（Issue #95）。

セッションは Anthropic 管理のクラウド VM で動き、完了するとブランチを push して PR を作る。マージ後は Amplify（フロント）と GitHub Actions（バックエンド CDK、Issue #94）が自動デプロイする。

## 初回セットアップ（ブラウザで1回だけ）

1. [claude.ai/code](https://claude.ai/code) にアクセスし、GitHub App を連携する
2. リポジトリアクセスの注意: **App のインストール範囲 ＝ セッションのアクセス範囲ではない**。セッションは連携した GitHub アカウントが見えるリポジトリ全体にアクセスできる。絞りたい場合は GitHub 側でアカウント権限を制限する
3. 画面上部の雲アイコン → 「Add cloud environment」で環境を作る
   - **Network access**: まずはデフォルトの Trusted（GitHub / npm / PyPI / AWS SDK 系ドメインを許可済み）で開始。足りないドメインが出たら Custom に切り替えて追加する（「Also include default list of common package managers」は残す）
   - **Environment variables**: 現時点では不要（Issue #96 で `TAVILY_API_KEY` を追加予定）
   - **Setup script**: 空でよい。依存インストールはリポジトリ側の SessionStart フックで自動実行される（下記）

## 依存インストールの自動実行（リポジトリ側・設定済み）

- [.claude/settings.json](../.claude/settings.json) の SessionStart フックが、セッション開始・再開のたびに [scripts/cloud-setup.sh](../scripts/cloud-setup.sh) を実行する
- スクリプトはルートと `infra/` の `npm ci` を行う。インストール時に `package-lock.json` のハッシュを `node_modules/.package-lock.sha256` に控えておき、一致する（＝依存が変わっていない）ときだけスキップして高速起動する。ロックファイルだけ更新されたブランチでも古い依存のまま動くことはない
- `$CLAUDE_CODE_REMOTE` がクラウド VM でだけ `true` になるため、ローカルの Claude Code セッションでは何もしない

## MCP サーバー（.mcp.json・Issue #96）

リポジトリ直下の `.mcp.json` で、クラウドセッションに持ち込む MCP を定義している。**AWS 認証が必要な MCP（cloudwatch / awsiac / awspricing 等）は意図的に含めていない**（長期キーを VM に置かないため。それらは Mac 作業専用）。

| サーバー | 種別 | 外部に送られるもの |
|---|---|---|
| `aws-knowledge` | HTTP（AWS 公式） | 検索クエリが `knowledge-mcp.global.api.aws` に送られる。認証不要 |
| `tavily-remote-mcp` | HTTP（Tavily 社） | Web 検索クエリが `mcp.tavily.com` に送られる。`TAVILY_API_KEY`（環境変数）が必要 |
| `awslabs-aws-documentation-mcp-server` | stdio（uvx でローカル起動） | AWS ドキュメント取得のリクエストのみ。バージョンは供給網対策で `==X.Y.Z` に固定しており、更新は PR で明示的に上げる |

- プロジェクトスコープの MCP は**初回セッションで承認プロンプトが出る**（無断で有効化はされない）。承認すると以後有効
- 検索クエリは Claude が文脈から生成するため、機密にしたい値（アカウント ID 等）を検索させたくない場合はプロンプトで明示する
- `TAVILY_API_KEY` はローカルでは `~/.zshrc.local`、クラウドでは環境設定の Environment variables で渡す。**キー本体をリポジトリに置かない**

## AWS の確認作業（verify プロファイル）

- [scripts/setup-aws-profile.sh](../scripts/setup-aws-profile.sh) が `~/.aws/config` に `verify` プロファイルを書き出す。認証は毎セッション `aws sso login --profile verify --use-device-code` で取得し、長期キーは VM にもリポジトリにも置かない
- クラウドのコンテナには AWS CLI が入っていないため、同じスクリプトが先に v2 を導入する（v2 が入っていれば飛ばす）。SSO のデバイスコードフローは v1 では動かないので、有無ではなくバージョンで判定している。SessionStart フックではなくこちらに置いたのは、AWS を触らないセッションにまで 70MB 超のダウンロードを負わせないため
- インストーラは実行前に PGP 署名を検証する。公開鍵は [scripts/aws-cli-public-key.asc](../scripts/aws-cli-public-key.asc) に同梱し、指紋 `FB5DB77FD5C118B80511ADA8A6310ACC4672475C` まで突き合わせる。配信元と同じホストから落とすハッシュでは配信側が乗っ取られたときに検証にならないため、ハッシュではなく署名を見る（AWS はこの zip に `.sha256` を公開しておらず、`.sig` だけを出している）
- 参照する Permission Set は `AgentVerifyAccess`。作成手順と権限の考え方は [agent-verify-permission-set.md](agent-verify-permission-set.md) にまとめてある
- このスクリプトも `$CLAUDE_CODE_REMOTE` を見てクラウド VM でだけ動く。ローカルの `~/.aws/config` を上書きしないため
- 変更操作は [scripts/deny-aws-writes.sh](../scripts/deny-aws-writes.sh)（`PreToolUse` フック）が止める。読み取り操作だけを通す許可リスト方式で、`get-` / `list-` / `describe-` などの接頭辞と、`sso login` / `logs tail` / `s3 ls` のような明示リストに載るものだけが通る。明示リストに足すときは、`ecs execute-command` のように名前が読み取りっぽくても実質が違うものがあるため、一つずつ実際の権限を確かめる。`invoke` や `assume-role` のように動詞が read でも write でもない操作を数え漏らさないため、拒否リストではなく許可リストにしている
- このフックはうっかり変更操作を打つのを止める関門であって、サンドボックスではない。コマンド文字列を読むだけなので、引用符の内側に隠した呼び出しや変数展開、SDK 経由の操作までは見えない。本当の境界は `AgentVerifyAccess` の IAM 側にある
- 判定のテストは [scripts/deny-aws-writes.test.mjs](../scripts/deny-aws-writes.test.mjs) にある。`node --test scripts/deny-aws-writes.test.mjs` で走る。CI は infra/ のテストしか回していないので、まだ自動では走らない
- このフックも**クラウドでだけ判定する**。`permissions.deny` に書くとリポジトリ共有のためローカルの正当な管理作業（`sso-admin create-permission-set` など）まで止まり、実際に一度それで詰まった
- Network access は `awsapps.com` と `*.amazonaws.com` への到達が必要。認証エラーに見える失敗はまずここを疑う

## コスト・利用枠の注意

- Web 版の利用は Max プランの共有枠（5時間枠＋週次枠）を消費する。ローカルの Claude Code やチャットと合算される
- 残枠は `/usage` コマンドまたは Web／アプリの設定画面で確認する
- Extra Usage（従量課金）を有効化する場合は Spending cap の設定を必須とする

## 動作確認の手順

1. iPhone から小さなタスク（README の誤字修正など）を1件投げる
2. PR が作られ、`infra/**` を触った場合は cdk diff がコメントされることを確認する
3. マージ後、GitHub Actions の deploy ワークフローが成功することを確認する
