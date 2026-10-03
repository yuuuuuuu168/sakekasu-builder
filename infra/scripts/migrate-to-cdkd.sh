#!/usr/bin/env bash
# CloudFormation で入れてあるアプリ本体のスタックを cdkd の管理へ移す。
#
# 移し終えた後は何もせずに抜ける（冪等）。結果は GITHUB_OUTPUT の engine= に書く。
# ローカルで打つときは GITHUB_OUTPUT が無いので標準出力に出る。
#
#   engine=cdkd  全スタックが cdkd の状態を持っている。cdkd deploy してよい
#   engine=cfn   移行の前検査で引っかかったので、何も変えていない。今回は cdk deploy で出す
#
# 守っている不変条件は1つ。「CloudFormation のスタックが残っていて、cdkd の状態が無い」
# スタックを cdkd deploy に渡さない。渡すと cdkd はそれを新規作成とみなし、同じ名前の
# DynamoDB テーブルや S3 バケットで落ちるか、Cognito の UserPool のように名前が重複
# できるものは2つ目を黙って作る（利用者のアカウントが空の新しいプールに切り替わる）。
#
# 取り込みは AWS 上のリソースを消さない。cdkd が全リソースに DeletionPolicy: Retain と
# UpdateReplacePolicy: Retain を付けてから CloudFormation のスタックを消すので、
# スタックの記録だけが無くなる。
#
# 使い方（infra/ で実行する）:
#   AWS_PROFILE=sakekasu-builder bash scripts/migrate-to-cdkd.sh
#
# 環境変数:
#   ENV_NAME       スタック名の接頭辞に使う環境名（既定 dev）
#   CDKD_ROLE_ARN  cdkd が引き受けるロール。cdkd が直接読む。CI では必須。手元から
#                  打つときは渡さない。sakekasu-cdkd-deploy の信頼ポリシーは
#                  sakekasu-github-actions-deploy だけを許しているので、人間が
#                  AdministratorAccess で渡しても sts:AssumeRole で拒否される
#   MAPPING_DIR    論理ID と物理ID の対応表の置き場所（既定はカレント）
set -euo pipefail

env_name="${ENV_NAME:-dev}"
: "${GITHUB_OUTPUT:=/dev/stdout}"
mapping_dir="${MAPPING_DIR:-.}"

prefix="sakekasu-${env_name}"

# 移す順番は「使う側から」。CloudFormation は、他のスタックが Fn::ImportValue で
# 読んでいる Export を持つスタックを消せないため、読む側を先に消す必要がある。
#
# このアプリの Export と ImportValue の向きは合成結果で確かめてある。
#
#   auth           export 2 / import 0   ← 誰からも読まれなくなるまで消せない
#   api            export 7 / import 1（auth から）
#   monitoring     export 0 / import 9（api から7、auth から2）
#   health-global  export 0 / import 0   ← 独立。us-east-1
#
# したがって monitoring → api → auth の順でなければ DeleteStack が
# 「Export ... cannot be deleted as it is in use by ...」で落ちる。
# health-global は誰とも Export をやり取りしないのでどこでもよいが、
# いちばん小さく戻しやすいので先頭に置き、往復の確認にも使う。
#
# スタック名とリージョンの組
stacks=(
  "${prefix}-health-global us-east-1"
  "${prefix}-monitoring ap-northeast-1"
  "${prefix}-api ap-northeast-1"
  "${prefix}-auth ap-northeast-1"
)

# このスクリプトが直に打つ aws コマンドの資格情報。
#
# CI で渡ってくるのは sakekasu-github-actions-deploy の資格情報で、この
# ロールは sts:AssumeRole しか持たない。実権限は cdkd 用に絞った
# sakekasu-cdkd-deploy の側にある。cdkd は CDKD_ROLE_ARN を自分で読んで
# 引き受けるが、それはスクリプトの aws コマンドには効かない。こちらも
# 同じロールを引き受ける。
#
# 2026-10-03、手順9 をマージした直後の deploy がここで落ちた。
# 「DescribeStacks on sakekasu-dev-health-global ... no identity-based policy
# allows」。cfn_exists は権限の失敗を握りつぶさず落とすので、スタックの
# 有無を取り違えたまま進むことはなかった。
#
# 引き受けた資格情報を環境変数として外に出さない。cdkd にまで渡ると、
# sakekasu-cdkd-deploy から sakekasu-cdkd-deploy を引き受けようとして落ちる
# （信頼ポリシーが許すのは sakekasu-github-actions-deploy だけ）。
# aws_cli の呼び出しごとに env で渡す。
cdkd_env=()
if [ -n "${CDKD_ROLE_ARN:-}" ]; then
  creds="$(aws sts assume-role --role-arn "$CDKD_ROLE_ARN" \
    --role-session-name migrate-to-cdkd \
    --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' --output text)"
  IFS=$'\t' read -r cdkd_key cdkd_secret cdkd_token <<<"$creds"
  if [ -z "$cdkd_key" ] || [ -z "$cdkd_secret" ] || [ -z "$cdkd_token" ]; then
    echo "::error::${CDKD_ROLE_ARN} を引き受けられませんでした" >&2
    exit 1
  fi
  cdkd_env=(
    env
    "AWS_ACCESS_KEY_ID=${cdkd_key}"
    "AWS_SECRET_ACCESS_KEY=${cdkd_secret}"
    "AWS_SESSION_TOKEN=${cdkd_token}"
  )
  unset creds cdkd_key cdkd_secret cdkd_token
fi

# 権限を持っている側で aws を打つ。CDKD_ROLE_ARN が無ければ素の aws
# （手元から打つとき。人間様の資格情報がそのまま権限を持っている）。
#
# ${x[@]+"${x[@]}"} は bash 3.2 で空配列を set -u の下で展開するための書き方。
# 素直に "${cdkd_env[@]}" と書くと unbound variable で落ちる
aws_cli() {
  ${cdkd_env[@]+"${cdkd_env[@]}"} aws "$@"
}

# CloudFormation のスタックがあるか。無いときだけ 1 を返し、それ以外の失敗
# （権限、スロットリング）は握りつぶさずに落とす。読めない状態を「無い」と
# 取り違えると、移行済みのスタックをもう一度取り込みにいってしまう
cfn_exists() {
  local name="$1" region="$2" err
  if err="$(aws_cli cloudformation describe-stacks --stack-name "$name" --region "$region" \
    --query 'Stacks[0].StackStatus' --output text 2>&1)"; then
    return 0
  fi
  if grep -q 'does not exist' <<<"$err"; then
    return 1
  fi
  echo "$err" >&2
  exit 1
}

# cdkd の状態に載っているスタック。"<スタック名> (<リージョン>)" の行で出る。
# bootstrap が済んでいないと読めないので、失敗したらそこで止める
cdkd_state_list="$(npx cdkd state list)"

cdkd_state_exists() {
  grep -qxF "$1 ($2)" <<<"$cdkd_state_list"
}

# cdkd import をスタックのリージョンで動かす。
#
# cdkd（0.291.31 時点）の import は、CloudFormation を読むクライアントを実行時の
# AWS_REGION で作り、スタックのリージョンを見ない。us-east-1 にある
# health-global を ap-northeast-1 で探して見つけられず、全リソースが
# 「not found」になる。import には --stack-region に当たるオプションが無いため、
# スタックごとに AWS_REGION を合わせて打つ。cdkd 側で直ったら消す。
#
# 状態を置くバケットが別のリージョンにあっても cdkd が向き先を直すので、
# こちらは気にしなくてよい。
#
# Cloud Control の識別子が CloudFormation の物理 ID と違う型の対応表を作る。
#
# cdkd は取り込むリソースの識別子に CloudFormation の物理 ID を使うが、Cloud
# Control 側が別の形を求める型がある。そのままだと
# 「Identifier ... is not valid for identifier [...]」で落ちる。
# --resource で明示すれば通る（--resource を1つでも渡すと指定したものしか
# 取り込まなくなるので、残りを自動解決させる --auto も付ける）。
#
# 2026-10-03 に手順7 の前検査で当たったのは3型。どれも物理 ID と識別子の
# 食い違いという同じ根で、issue #228 の AWS::IAM::Policy と同じ家族。
#
#   AWS::Cognito::UserPoolClient  要 "<UserPoolId>|<ClientId>"  物理 ID は ClientId だけ
#   AWS::Logs::MetricFilter       要 "<LogGroupName>|<FilterName>"  物理 ID は FilterName だけ
#   AWS::AppSync::GraphQLApi      要 "<ApiId>"  物理 ID は ARN
#
# UserPoolClient の件は 0.291.16 で先行リポジトリが踏んでおり、
# go-to-k/cdkd#3701 で 0.291.23 修正済みと読んで一度この回避を外したが、
# 0.291.31 でも現に落ちた。手順5 の cdkd diff では出ず、取り込みで初めて出る。
#
# 標準出力に --resource の引数を1行1トークンで書く。呼ぶ側が配列に読む。
identifier_overrides() {
  local name="$1" region="$2" resources logical phys pool pools filters log_group
  resources="$(aws_cli cloudformation describe-stack-resources --stack-name "$name" --region "$region" \
    --query 'StackResources[].[LogicalResourceId,ResourceType,PhysicalResourceId]' --output text)"

  local out=()

  # Cognito の UserPoolClient。同じスタックの User Pool と組にする
  if grep -q $'\tAWS::Cognito::UserPoolClient\t' <<<"$resources"; then
    pools="$(awk -F'\t' '$2 == "AWS::Cognito::UserPool" { print $3 }' <<<"$resources")"
    if [ -z "$pools" ] || [ "$(grep -c . <<<"$pools")" -ne 1 ]; then
      echo "::error::${name} の UserPoolClient に対応する User Pool を1つに決められません" >&2
      return 1
    fi
    pool="$pools"
    while IFS=$'\t' read -r logical _ phys; do
      out+=("--resource" "${logical}=${pool}|${phys}")
    done < <(awk -F'\t' '$2 == "AWS::Cognito::UserPoolClient"' <<<"$resources")
  fi

  # Logs の MetricFilter。物理 ID が FilterName なので、そこから LogGroupName を引く。
  # describe-metric-filters の --filter-name-prefix は --log-group-name と一緒でないと
  # 効かないため、リージョン全体を引いて名前で突き合わせる
  if grep -q $'\tAWS::Logs::MetricFilter\t' <<<"$resources"; then
    filters="$(aws_cli logs describe-metric-filters --region "$region" \
      --query 'metricFilters[].[filterName,logGroupName]' --output text)"
    while IFS=$'\t' read -r logical _ phys; do
      log_group="$(awk -F'\t' -v f="$phys" '$1 == f { print $2 }' <<<"$filters")"
      if [ -z "$log_group" ] || [ "$(grep -c . <<<"$log_group")" -ne 1 ]; then
        echo "::error::${name} の ${logical}（${phys}）のロググループを1つに決められません" >&2
        return 1
      fi
      out+=("--resource" "${logical}=${log_group}|${phys}")
    done < <(awk -F'\t' '$2 == "AWS::Logs::MetricFilter"' <<<"$resources")
  fi

  # AppSync の GraphQLApi。物理 ID が ARN なので ApiId だけを渡す
  while IFS=$'\t' read -r logical _ phys; do
    [ -n "$logical" ] || continue
    out+=("--resource" "${logical}=${phys##*/}")
  done < <(awk -F'\t' '$2 == "AWS::AppSync::GraphQLApi"' <<<"$resources")

  if [ "${#out[@]}" -eq 0 ]; then
    return 0
  fi

  printf '%s\n' "${out[@]}" --auto
}

# bash 3.2 で動かすこと。macOS に入っているのはいまも 3.2 で、mapfile や
# readarray、連想配列は使えない。最初に書いたときは mapfile を使っていて、
# macOS では「mapfile: command not found」を出しながら --resource を1つも
# 渡さずに走り、前検査が同じ失敗を繰り返した。警告が流れるだけで止まらないので
# 気づきにくい。__tests__/migrate-to-cdkd.test.ts が書き方を検査している。
cdkd_import() {
  local name="$1" region="$2"
  shift 2

  local raw line expected=0 added=0
  if ! raw="$(identifier_overrides "$name" "$region")"; then
    exit 1
  fi

  local args=("$name" --record-resource-mapping "${mapping_dir}/mapping-${name}.json")
  if [ -n "$raw" ]; then
    expected="$(grep -c . <<<"$raw")"
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      args+=("$line")
      added=$((added + 1))
    done <<<"$raw"
  fi

  # 組み立てに失敗したまま素通りさせない。黙って --resource 無しで走ると、
  # 取り込めるはずのリソースが「識別子が不正」で落ちる
  if [ "$added" -ne "$expected" ]; then
    echo "::error::${name} の --resource を組み立てられませんでした（${expected} 件のうち ${added} 件）" >&2
    exit 1
  fi

  args+=("$@" -c "env=${env_name}")

  AWS_REGION="$region" AWS_DEFAULT_REGION="$region" npx cdkd import "${args[@]}"
}

# 取り込みが要るスタックを集める
pending=()
for entry in "${stacks[@]}"; do
  read -r name region <<<"$entry"
  if cfn_exists "$name" "$region"; then
    if cdkd_state_exists "$name" "$region"; then
      # 前回の移行で状態は書けたが、CloudFormation 側を消すところで止まっている。
      # ここから自動で進めると、どちらの管理下にあるのか分からないまま
      # deploy することになるので手を止める
      echo "::error::${name} は cdkd の状態と CloudFormation のスタックの両方を持っています。docs/cdkd-migration.md の「移行が途中で止まったとき」を見てください"
      exit 1
    fi
    pending+=("$entry")
  fi
done

if [ "${#pending[@]}" -eq 0 ]; then
  echo "移行が要るスタックはありません"
  echo 'engine=cdkd' >>"$GITHUB_OUTPUT"
  exit 0
fi

echo "cdkd へ移すスタック: ${pending[*]}"

# 1. 前検査。ここではどのスタックにも手を付けない。1つでも取り込めない
#    リソースがあれば、全部を CloudFormation に残したまま抜ける
ok=true
for entry in "${pending[@]}"; do
  read -r name region <<<"$entry"
  echo "::group::cdkd import --dry-run ${name}"
  if ! log="$(cdkd_import "$name" "$region" --dry-run 2>&1)"; then
    echo "$log"
    echo "::endgroup::"
    echo "::warning::${name} の import --dry-run が失敗しました"
    ok=false
    continue
  fi
  echo "$log"
  echo "::endgroup::"
  summary="$(grep -E 'Summary: [0-9]+ imported' <<<"$log" | tail -n 1 || true)"
  if ! grep -qE 'Summary: [1-9][0-9]* imported, 0 not found, 0 unsupported, 0 out of scope, 0 failed' <<<"$summary"; then
    echo "::warning::${name} に取り込めないリソースがあります: ${summary:-（Summary 行が見つかりません）}"
    ok=false
  fi
done

if [ "$ok" != true ]; then
  echo "::warning::cdkd への移行を見送ります。スタックには手を付けていません"
  echo 'engine=cfn' >>"$GITHUB_OUTPUT"
  exit 0
fi

# 2. 移行。使う側から順に
for entry in "${pending[@]}"; do
  read -r name region <<<"$entry"
  echo "::group::cdkd import --migrate-from-cloudformation ${name}"
  cdkd_import "$name" "$region" --migrate-from-cloudformation --yes
  echo "::endgroup::"
done

# 3. 不変条件の確認。1つでも CloudFormation に残っていれば止める。
#    cdk deploy にも戻さない。半分移った状態で CloudFormation 側を更新すると、
#    どちらの管理下なのか分からなくなる
for entry in "${stacks[@]}"; do
  read -r name region <<<"$entry"
  if cfn_exists "$name" "$region"; then
    echo "::error::${name} の CloudFormation スタックが残っています。cdkd deploy は打ちません"
    exit 1
  fi
done

echo 'engine=cdkd' >>"$GITHUB_OUTPUT"
