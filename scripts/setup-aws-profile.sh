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

# クラウドのコンテナには AWS CLI が入っていない（Issue #162）。使い捨てのコンテナなので
# 毎セッション導入が要る。SSO のデバイスコードフローは v1 では動かないため、
# 「入っているか」ではなく「v2 が入っているか」で判定する。
# 環境キャッシュから再開したセッションには /usr/local/bin/aws が残っている場合がある。
ensure_aws_cli_v2() {
  if command -v aws > /dev/null 2>&1; then
    # v1 はバージョンを stderr に出すため 2>&1 でまとめて受ける
    version=$(aws --version 2>&1 || true)
    case "$version" in
      aws-cli/2.*)
        echo "AWS CLI already installed: $version"
        return 0
        ;;
      *)
        echo "Found non-v2 AWS CLI ($version). Installing v2."
        ;;
    esac
  fi

  case "$(uname -m)" in
    x86_64) arch=x86_64 ;;
    aarch64 | arm64) arch=aarch64 ;;
    *)
      echo "Unsupported architecture: $(uname -m)" >&2
      return 1
      ;;
  esac

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT

  echo "Installing AWS CLI v2 ($arch)..."
  curl -fsSL -o "$tmp/awscliv2.zip" "https://awscli.amazonaws.com/awscli-exe-linux-$arch.zip"
  unzip -q "$tmp/awscliv2.zip" -d "$tmp"
  # --update は既存インストールの有無にかかわらず通る
  "$tmp/aws/install" --update

  rm -rf "$tmp"
  trap - EXIT

  # 直前まで aws が無かった場合、シェルが「見つからない」を覚えているため消す
  hash -r
  echo "AWS CLI installed: $(aws --version 2>&1)"
}

ensure_aws_cli_v2

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
sso_role_name = AgentVerifyAccess
region = ap-northeast-1
output = json
EOF

echo "AWS profile 'verify' configured."
