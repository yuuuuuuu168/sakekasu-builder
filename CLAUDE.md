# CLAUDE.md

## Git / ブランチ運用

- 機能開発は必ず feature ブランチを作成してから作業する
- ブランチに初回 push したら、必ず PR も作成する（push だけで終わらせない）
- PR のレビュー・マージは人間様が行う。余は PR 作成まで

### PR を作ったら watch する

PR を作成したら、ユーザーの指示を待たずにそのまま `subscribe_pr_activity` を呼び、
その PR の CI とレビューコメントを watch する。毎回「watch して」と言わせない。

- watch を始めたら、PR の URL とあわせて一行で報告する
- CI が落ちたら原因を調べて直し、同じブランチに push する。落ちた理由が自分の変更と
  無関係（base ブランチが赤い等）なら、その旨を PR に一度だけ書く
- レビューコメントは対応するか、対応しない理由を返す。黙って終わらせない
- watch はマージまたはクローズまで続ける。止めるのはユーザーに言われたときだけ

PR 作成の直後には [scripts/pr-watch-reminder.mjs](scripts/pr-watch-reminder.mjs)（`PostToolUse`
フック）が PR 番号つきで watch を促す。長いセッションでこの節が押し流されても効く。

## AWS確認作業の認証フロー

AWS環境の確認が必要になったら、ユーザーの指示を待たずに次を実行する。

```sh
bash scripts/aws-sso-login.sh
```

AWS CLI v2 の導入、`verify` プロファイルの配置、SSO ログインの開始までをこれ一つで行う。
認証済みなら何もせず終わる。出力された確認URLとコードはそのままユーザーに提示し、
`bash scripts/aws-sso-login.sh --wait` で承認の完了を確かめてから続行する。
以降のAWS CLI操作には必ず `--profile verify` を付ける。

デバイスコードフローの `aws sso login` は承認されるまで前面で待ち続けるため、
Bash ツールから直に実行するとURLとコードを渡せないまま固まる。スクリプトは
ログインを背後に回し、URLとコードだけを先に返す。

セッション開始の時点でログインまで済ませたい場合は、クラウド環境の Environment
variables に `SAKEKASU_AWS_LOGIN=1` を設定する。既定で走らせないのは、AWS を触らない
セッションにまで AWS CLI の 70MB 超のダウンロードを負わせないため。

このプロファイルは読み取り専用（Permission Set `AgentVerifyAccess`）。create / update / delete / put 系の
変更操作は実行しない。CloudWatch Logs・メトリクス・Application Signals は読めるが、S3 オブジェクト本文・
DynamoDB レコード・Cognito ユーザー・SSM パラメータは IAM 側で拒否される（[docs/agent-verify-permission-set.md](docs/agent-verify-permission-set.md)）。
認証エラーに見える失敗が出た場合、まずcloud environmentのネットワーク設定で
`awsapps.com` と `*.amazonaws.com` への到達が許可されているかを疑う。

なお `aws-sso-login.sh` と `setup-aws-profile.sh` は `~/.aws/config` を上書きするため、
クラウドセッション（`CLAUDE_CODE_REMOTE=true`）でのみ動作する。ローカルでは何もせず終了する。
