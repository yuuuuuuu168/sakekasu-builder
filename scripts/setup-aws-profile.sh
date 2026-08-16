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

# AWS CLI Team の署名鍵の指紋。AWS の公式インストール手順に載っているもので、
# 公開鍵そのものは scripts/aws-cli-public-key.asc に置いてある（鍵の期限は 2027-07-01）。
AWS_CLI_KEY_FINGERPRINT=FB5DB77FD5C118B80511ADA8A6310ACC4672475C

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

  if ! command -v gpg > /dev/null 2>&1; then
    echo "gpg not found. Cannot verify the AWS CLI installer signature." >&2
    return 1
  fi

  script_dir=$(cd "$(dirname "$0")" && pwd)
  base_url="https://awscli.amazonaws.com/awscli-exe-linux-$arch.zip"

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT

  echo "Installing AWS CLI v2 ($arch)..."
  curl -fsSL -o "$tmp/awscliv2.zip" "$base_url"
  curl -fsSL -o "$tmp/awscliv2.zip.sig" "$base_url.sig"

  # インストーラを実行する前に PGP 署名を確かめる。配信元と同じホストから
  # 落とすハッシュでは、配信側が乗っ取られたときに検証にならないため、
  # リポジトリに同梱した AWS CLI Team の公開鍵で照合する。
  # 鍵束は $tmp に作り、セッションの ~/.gnupg には触らない
  GNUPGHOME="$tmp/gnupg"
  export GNUPGHOME
  mkdir -p "$GNUPGHOME"
  chmod 700 "$GNUPGHOME"
  gpg --batch --quiet --import "$script_dir/aws-cli-public-key.asc"

  # gpg の終了コードだけでは、鍵束に別の鍵が紛れ込んだ場合に通ってしまう。
  # 機械可読な出力から指紋まで突き合わせる。grep へ直接パイプすると
  # SIGPIPE と pipefail で誤判定し得るので、いったん変数に受ける
  verify_status=$(gpg --batch --status-fd 1 --verify "$tmp/awscliv2.zip.sig" "$tmp/awscliv2.zip" 2> /dev/null || true)
  case "$verify_status" in
    *"VALIDSIG $AWS_CLI_KEY_FINGERPRINT"*)
      echo "Installer signature verified ($AWS_CLI_KEY_FINGERPRINT)."
      ;;
    *)
      echo "Signature verification failed for the AWS CLI installer. Aborting." >&2
      return 1
      ;;
  esac
  unset GNUPGHOME

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
sso_account_id = <アプリのアカウント ID>
sso_role_name = AgentVerifyAccess
region = ap-northeast-1
output = json
EOF

echo "AWS profile 'verify' configured."
