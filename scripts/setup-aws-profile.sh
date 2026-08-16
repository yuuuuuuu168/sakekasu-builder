#!/usr/bin/env bash
# クラウドセッションから読み取り専用のAWS確認作業をするための verify プロファイルを配置する。
# 認証は IAM Identity Center のデバイスコードフローで毎回取得するため、
# ここで書き出す ~/.aws/config にシークレットは含まれない（SSOのURL・アカウントID・ロール名のみ）。
set -euo pipefail

# ローカルセッションでは何もしない。ローカルの ~/.aws/config には
# 開発用の複数プロファイルが入っており、上書きすると失われるため。
# True / TRUE / 1 でも通るよう、比較前に小文字へ正規化する
remote=$(printf '%s' "${CLAUDE_CODE_REMOTE:-}" | tr '[:upper:]' '[:lower:]')
if [ "$remote" != "true" ] && [ "$remote" != "1" ]; then
  echo "Local session detected. Skipped (would overwrite ~/.aws/config)."
  exit 0
fi

mkdir -p ~/.aws

# ガードをすり抜けた場合の保険。上書き前に必ず退避する
if [ -f ~/.aws/config ]; then
  backup=~/.aws/config.bak.$(date +%Y%m%d-%H%M%S)
  cp ~/.aws/config "$backup"
  echo "Backed up existing config to $backup"
fi

cat > ~/.aws/config << 'EOF'
[profile verify]
sso_start_url = https://d-xxxxxxxxxx.awsapps.com/start
sso_region = ap-northeast-1
sso_account_id = 232791540685
sso_role_name = ReadOnlyAccess
region = ap-northeast-1
output = json
EOF

echo "AWS profile 'verify' configured."
