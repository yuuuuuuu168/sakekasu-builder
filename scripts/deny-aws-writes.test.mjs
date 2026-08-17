// deny-aws-writes.mjs の判定のテスト。依存を増やしたくないので node:test で書く。
// 実行は `node --test scripts/deny-aws-writes.test.mjs`。
// このリポジトリの CI は infra/ のテストしか回していないため、まだ自動では走らない。
//
// 関数を import せず、フックと同じように子プロセスへ JSON を流し込んでいる。
// 「直接実行されたときだけ判定する」ガードを置くと、実行パスにシンボリックリンクが
// 挟まったときに判定ごと素通りするため、ガードを設けずに済む形にしてある。
//
// PR #164 のセキュリティレビューで指摘されたバイパスの各形を、ここに固定する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('./deny-aws-writes.mjs', import.meta.url));

function run(command) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `フックは常に 0 で終わる: ${result.stderr}`);
  return result.stdout;
}

const allows = (command) => assert.equal(run(command), '', `通るはず: ${command}`);
const denies = (command) => assert.match(
  run(command),
  /"permissionDecision":"deny"/,
  `止まるはず: ${command}`,
);

test('読み取り操作は通す', () => {
  allows('aws logs tail /aws/lambda/dev-sakekasu-health-check --since 30m');
  allows('aws logs tail /aws/lambda/x --follow --profile verify');
  allows('aws --profile verify logs tail /aws/lambda/x');
  allows('/usr/local/bin/aws logs tail /aws/lambda/x');
  allows('aws logs filter-log-events --log-group-name /aws/lambda/x');
  allows('aws sts get-caller-identity --profile verify');
  allows('aws logs start-query --profile verify');
  allows('aws s3 ls s3://bucket');
  allows('aws --version');
  allows('aws help');
});

test('変更操作は止める', () => {
  denies('aws logs delete-log-group --log-group-name /aws/lambda/x');
  denies('aws logs put-retention-policy --log-group-name x --retention-in-days 7');
  denies('aws lambda invoke --function-name x out.json');
  denies('aws sts assume-role --role-arn arn:aws:iam::1:role/x --role-session-name s');
  denies('aws ec2 run-instances --image-id ami-1');
});

test('名前が読み取りっぽくても実質が違うものは止める', () => {
  denies('aws ecs execute-command --command /bin/sh');
});

test('s3 の高レベルコマンドは ls だけを通す', () => {
  denies('aws s3 cp local.txt s3://bucket/');
  denies('aws s3 sync . s3://bucket/');
  denies('aws s3 mv a s3://bucket/b');
});

test('読み取り操作に似た綴りは通さない', () => {
  denies('aws logs tail-something');
  denies('aws tail');
});

// 区切り文字が直前の引数と融合していても、2 つ目の呼び出しを見つけられること
test('区切り文字が空白で挟まれていなくても後続の呼び出しを見る', () => {
  const write = 'logs delete-log-group --log-group-name y';
  denies(`aws logs tail /my-group;aws ${write}`);
  denies(`aws logs tail /g --follow;aws ${write}`);
  denies(`aws logs tail /g --follow&&aws ${write}`);
  denies(`aws logs tail /g||aws ${write}`);
  denies(`aws logs tail /g&aws ${write}`);
  denies(`aws sts get-caller-identity;aws ${write}`);
  denies(`echo $(aws ${write})`);
  denies(`echo \`aws ${write}\``);
  denies('aws logs tail /g;aws ec2 terminate-instances --instance-ids i-0abc123');
});

test('空白で区切られた形も従来どおり見る', () => {
  denies('aws logs tail /g && aws logs delete-log-group --log-group-name y');
  denies('aws logs tail /g | aws logs put-retention-policy --log-group-name y');
});

// シェルは引用符をまたいだ断片を 1 語につなぐ。判定もそれに合わせること
test('語の途中や先頭に空の引用符を挟んでも見る', () => {
  denies('aws "logs" delete-log-group --log-group-name y');
  denies("aws 'logs' delete-log-group --log-group-name y");
  denies('aws ""s3api delete-object --bucket x --key y');
  denies("aws ''s3api delete-object --bucket x --key y");
  denies('aws "" s3api delete-object --bucket x --key y');
  denies('aws s""3api delete-object --bucket x --key y');
  denies('aws s3""api delete-object --bucket x --key y');
  denies("aws s''3api delete-object --bucket x --key y");
  denies('aws e""c2 terminate-instances --instance-ids i-0abc123');
  denies('aws i""am create-user --user-name x');
  denies('aws lo""gs delete-log-group --log-group-name y');
  denies('aws l""ambda invoke --function-name x out.json');
  denies('aws logs de""lete-log-group --log-group-name y');
});

// bash は引用や打ち消しでコマンド名そのものを隠せる。字面だけを見ると素通りする
test('引用や打ち消しでコマンド名を隠しても止める', () => {
  const write = 'logs delete-log-group --log-group-name y';
  denies(`$'\\x61\\x77\\x73' ${write}`); // ANSI-C 引用（16進）
  denies(`$'\\141\\167\\163' ${write}`); // 同（8進）
  denies(`$'\\u0061\\u0077\\u0073' ${write}`); // 同（Unicode）
  denies(`$"aws" ${write}`); // ロケール引用。翻訳が無ければそのまま aws になる
});

test('行継続で分けても止める', () => {
  denies('aws \\\nlogs delete-log-group --log-group-name y');
  denies('aws logs \\\ndelete-log-group --log-group-name y');
});

// 二重引用符の中でもコマンド置換は効く
test('二重引用符の中のコマンド置換も見る', () => {
  const write = 'logs delete-log-group --log-group-name y';
  denies(`echo "$(aws ${write})"`);
  denies(`echo "\`aws ${write}\`"`);
  denies(`MSG="$(aws ${write})" && echo done`);
});

test('読み取り操作は引用や行継続をまたいでも通す', () => {
  allows('echo "$(aws sts get-caller-identity)"');
  allows('aws logs tail \\\n/aws/lambda/x --since 30m');
});

// 置換のあとも元の引用が続いていること。引用の外に出たままにすると、
// 元の引用を閉じる " が開き側と見なされ、後ろのコマンドを丸ごと飲み込む
test('コマンド置換のあとに続く呼び出しを見落とさない', () => {
  denies('echo "$(aws sts get-caller-identity)" && aws s3 rm s3://b/k');
  denies('MSG="$(aws s3 ls)"; aws s3api delete-object --bucket x --key y');
  denies('x="`aws sts get-caller-identity`" && aws s3 cp local s3://b/');
  allows('echo "$(aws sts get-caller-identity)" && echo done');
  allows('MSG="$(aws logs describe-log-groups)" && echo "$MSG"');
});

// 判定が例外で落ちると終了コードが 1 になり、フックの異常として素通りする
test('読み切れないコマンドは拒否側に倒す', () => {
  denies("$'\\U00110000' aws s3api delete-object --bucket x --key y");
  // 範囲外の打ち消しでも例外にせず読み切る。aws 呼び出しが無ければ通してよい。
  // allows は終了コードが 0 であることも見るので、落ちれば失敗する
  allows("$'\\UFFFFFFFF' echo hello");
  denies("$'aws logs delete-log-group --log-group-name y"); // $' の閉じ忘れ
  denies('echo "unterminated'); // 二重引用符の閉じ忘れ
  denies('echo $(aws logs delete-log-group --log-group-name y'); // 置換の閉じ忘れ
});

test('通常の引用は誤検知しない', () => {
  allows("echo \"it's fine\"");
  allows("awk '{print $1}' file.txt");
  allows('for f in *.ts; do echo "$f"; done');
  allows('echo `date`');
  allows('bash -c "npm test"');
});

test('変数展開でサービス名を隠しても止める', () => {
  denies('aws $SERVICE delete-object --bucket x --key y');
  denies('aws ${SERVICE} delete-object --bucket x --key y');
});

// ここから下は誤検知側。散文やパスを呼び出しと読み違えないこと
test('散文に混じった aws は呼び出しと見なさない', () => {
  allows('git commit -m "aws の導入手順を書き直す"');
  allows('echo クラウドには aws が入っていないため手で入れる');
});

test('引数として渡されたパスは呼び出しと見なさない', () => {
  allows('rm -f /usr/local/bin/aws /usr/local/bin/aws_completer');
  allows('ls -la /usr/local/bin/aws');
});

test('aws を含む無関係なコマンドは通す', () => {
  allows('npm run build');
  allows('grep -rn "aws" scripts/');
});

test('引用符で囲った引数の中の区切り文字は区切りにしない', () => {
  allows('aws logs filter-log-events --filter-pattern "a;b" --log-group-name x');
});

test('壊れた入力では判定しない', () => {
  const result = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});
