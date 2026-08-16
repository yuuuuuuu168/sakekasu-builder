#!/usr/bin/env bash
# クラウドセッションから読み取り専用のAWS確認作業をするための verify プロファイルを配置する。
# 認証は IAM Identity Center のデバイスコードフローで毎回取得するため、
# ここで書き出す ~/.aws/config にシークレットは含まれない（SSOのURL・アカウントID・ロール名のみ）。
set -euo pipefail

# ローカルセッションでは何もしない。ローカルの ~/.aws/config には
# 開発用の複数プロファイルが入っており、上書きすると失われるため
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  echo "Local session detected. Skipped (would overwrite ~/.aws/config)."
  exit 0
fi

mkdir -p ~/.aws
cat > ~/.aws/config << 'EOF'
[profile verify]
sso_start_url = https://d-xxxxxxxxxx.awsapps.com/start
sso_region = ap-northeast-1
sso_account_id = <アプリのアカウント ID>
sso_role_name = ReadOnlyAccess
region = ap-northeast-1
output = json
EOF

echo "AWS profile 'verify' configured."
