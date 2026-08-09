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
