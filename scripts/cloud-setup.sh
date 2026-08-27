#!/usr/bin/env bash
# Claude Code on the web のクラウドセッション用セットアップ（Issue #95）。
# .claude/settings.json の SessionStart フックから毎セッション呼ばれる。
set -euo pipefail

# ローカルセッションでは何もしない（このフックはリポジトリ共有設定のため、
# ローカルの Claude Code でも発火する。クラウドVMだけを対象にする）
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$(dirname "$0")/.."

hash_file() {
  # クラウドVM（Linux）は sha256sum、macOS は shasum
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1"
  else
    shasum -a 256 "$1"
  fi | cut -d' ' -f1
}

# 環境キャッシュから再開したセッションには node_modules が残っているが、
# ディレクトリの有無だけで npm ci を省くと、package-lock.json だけ更新された
# ブランチで依存が古いまま動いてしまう。インストール時のロックファイルの
# ハッシュを控えておき、一致するときだけ省く
install_if_needed() {
  local dir=$1
  local marker="$dir/node_modules/.package-lock.sha256"
  local current
  current=$(hash_file "$dir/package-lock.json")
  if [ "$(cat "$marker" 2>/dev/null)" != "$current" ]; then
    (cd "$dir" && npm ci)
    echo "$current" > "$marker"
  fi
}

install_if_needed .
install_if_needed infra

# AI-DLC（.claude/ 配下）の CLI ツールとフックは全部 bun で動く。クラウドVMの
# イメージには既に入っているが、入っていない世代を引いたときに全フックが
# 黙って落ちるので、ここで用意しておく。
#
# 公式の curl -fsSL https://bun.sh/install は使えない。このクラウド環境の
# egress は bun.sh への CONNECT を 403 で塞ぐ。npm レジストリは上の npm ci が
# 通っている時点で到達できているので、そちらから入れる
if ! command -v bun >/dev/null 2>&1; then
  echo "bun が無いので npm から入れる（AI-DLC のフックとCLIツールに要る）"
  npm install -g bun || echo "bun の導入に失敗した。/aidlc は動かないが、それ以外の作業には影響しない。"
fi

# セッション開始時の運用方針。SessionStart フックの標準出力はそのまま Claude の
# 文脈に入るので、CLAUDE.md と同じ内容をここでも一度渡しておく。CLAUDE.md は
# 長いセッションでは押し流されるが、こちらは毎セッションの先頭に必ず載る
cat << 'POLICY'

[session policy]
- AWS の確認が要るときは、指示を待たずに `bash scripts/aws-sso-login.sh` を実行し、
  出力された URL とコードをそのままユーザーに提示して承認を待つ。以降の AWS CLI には
  必ず `--profile verify` を付ける（読み取り専用）。
- PR を作ったら、指示を待たずに subscribe_pr_activity でその PR を watch する。
POLICY

# 環境変数 SAKEKASU_AWS_LOGIN=1 を設定した環境では、AWS の確認を待たずに
# セッション開始の時点でログインまで済ませる。既定で走らせないのは、AWS を
# 触らないセッションにまで AWS CLI の 70MB 超のダウンロードを負わせないため
if [ "${SAKEKASU_AWS_LOGIN:-}" = "1" ]; then
  echo
  bash "$(dirname "$0")/aws-sso-login.sh" || echo "AWS SSO のログイン開始に失敗した。必要になった時点で再実行する。"
fi
