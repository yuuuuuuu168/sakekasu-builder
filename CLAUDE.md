# CLAUDE.md

## Git / ブランチ運用

- 機能開発は必ず feature ブランチを作成してから作業する
- ブランチに初回 push したら、必ず PR も作成する（push だけで終わらせない）
- PR のレビュー・マージは人間様が行う。余は PR 作成まで

## AWS確認作業の認証フロー

AWS環境の確認が必要になったら、次の手順で認証を依頼する。

1. `bash scripts/setup-aws-profile.sh` を実行してプロファイルを配置する（未実行の場合のみ）
2. `aws sso login --profile verify --use-device-code` を実行する
3. 表示された確認URLとコードをそのままユーザーに提示し、承認完了を待ってから続行する
4. 以降のAWS CLI操作には必ず `--profile verify` を付ける

このプロファイルは読み取り専用。create / update / delete / put 系の変更操作は実行しない。
認証エラーに見える失敗が出た場合、まずcloud environmentのネットワーク設定で
`awsapps.com` と `*.amazonaws.com` への到達が許可されているかを疑う。

なお `setup-aws-profile.sh` は `~/.aws/config` を上書きするため、クラウドセッション
（`CLAUDE_CODE_REMOTE=true`）でのみ動作する。ローカルでは何もせず終了する。
