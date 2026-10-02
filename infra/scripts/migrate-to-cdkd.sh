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
#   CDKD_ROLE_ARN  cdkd が引き受けるロール。cdkd が直接読む。CI では必須
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

# CloudFormation のスタックがあるか。無いときだけ 1 を返し、それ以外の失敗
# （権限、スロットリング）は握りつぶさずに落とす。読めない状態を「無い」と
# 取り違えると、移行済みのスタックをもう一度取り込みにいってしまう
cfn_exists() {
  local name="$1" region="$2" err
  if err="$(aws cloudformation describe-stacks --stack-name "$name" --region "$region" \
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
# なお 0.291.16 では Cognito の UserPoolClient も取り込めず、物理 ID を
# "<UserPoolId>|<ClientId>" の形で --resource に渡す回避が要った。これは
# 0.291.23 で直っている（go-to-k/cdkd#3701）ので、こちらでは書いていない。
# UserPoolClient の取り込みで落ちたら、まずここを疑う。
cdkd_import() {
  local name="$1" region="$2"
  shift 2
  AWS_REGION="$region" AWS_DEFAULT_REGION="$region" \
    npx cdkd import "$name" \
      --record-resource-mapping "${mapping_dir}/mapping-${name}.json" \
      "$@" -c "env=${env_name}"
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
