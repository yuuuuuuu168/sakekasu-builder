#!/usr/bin/env bash
# AI-DLC（.claude/ 配下）の CLI ツールとフックは全部 bun で動く。クラウドVMの
# イメージには既に入っているが、入っていない世代を引いたときに全フックが
# 黙って落ちるので、ここで用意しておく。scripts/cloud-setup.sh が npm ci のあとに呼ぶ。
#
# 公式の curl -fsSL https://bun.sh/install は使えない。このクラウド環境の
# egress は bun.sh への CONNECT を 403 で塞ぐ。npm レジストリは cloud-setup.sh の npm ci が
# 通っている時点で到達できているので、そちらから入れる
if ! command -v bun >/dev/null 2>&1; then
  echo "bun が無いので npm から入れる（AI-DLC のフックとCLIツールに要る）"
  npm install -g bun || echo "bun の導入に失敗した。/aidlc は動かないが、それ以外の作業には影響しない。"
fi
