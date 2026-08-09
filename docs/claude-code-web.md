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

## コスト・利用枠の注意

- Web 版の利用は Max プランの共有枠（5時間枠＋週次枠）を消費する。ローカルの Claude Code やチャットと合算される
- 残枠は `/usage` コマンドまたは Web／アプリの設定画面で確認する
- Extra Usage（従量課金）を有効化する場合は Spending cap の設定を必須とする

## 動作確認の手順

1. iPhone から小さなタスク（README の誤字修正など）を1件投げる
2. PR が作られ、`infra/**` を触った場合は cdk diff がコメントされることを確認する
3. マージ後、GitHub Actions の deploy ワークフローが成功することを確認する
