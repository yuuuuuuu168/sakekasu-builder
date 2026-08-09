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

# 環境キャッシュから再開したセッションには node_modules が残っている。
# npm ci は毎回 node_modules を作り直して遅いので、無いときだけ入れる
if [ ! -d node_modules ]; then
  npm ci
fi
if [ ! -d infra/node_modules ]; then
  (cd infra && npm ci)
fi
