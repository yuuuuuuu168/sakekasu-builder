// deny-aws-writes.mjs の判定のテスト。依存を増やしたくないので node:test で書く。
// 実行は `node --test scripts/deny-aws-writes.test.mjs`。
// このリポジトリの CI は infra/ のテストしか回していないため、まだ自動では走らない。
//
// PR #164 のセキュリティレビューで、区切り文字が引数と融合すると 2 つ目の呼び出しを
// 見落とすと指摘された。同じ形が戻らないよう、バイパスの各形をここに固定する。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findDenied } from './deny-aws-writes.mjs';

const allows = (command) => assert.equal(findDenied(command), null, `通るはず: ${command}`);
const denies = (command) => assert.notEqual(findDenied(command), null, `止まるはず: ${command}`);

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

// ここから下がレビュー指摘の再発防止。区切り文字が直前の引数と
// 融合していても、2 つ目の呼び出しを見つけられること
test('区切り文字が空白で挟まれていなくても後続の呼び出しを見る', () => {
  const write = 'logs delete-log-group --log-group-name y';
  denies(`aws logs tail /my-group;aws ${write}`);
  denies(`aws logs tail /g --follow;aws ${write}`);
  denies(`aws logs tail /g --follow&&aws ${write}`);
  denies(`aws logs tail /g||aws ${write}`);
  denies(`aws logs tail /g&aws ${write}`);
  denies(`aws sts get-caller-identity;aws ${write}`);
  denies(`echo $(aws ${write})`);
  denies('aws logs tail /g;aws ec2 terminate-instances --instance-ids i-0abc123');
});

test('空白で区切られた形も従来どおり見る', () => {
  denies('aws logs tail /g && aws logs delete-log-group --log-group-name y');
  denies('aws logs tail /g | aws logs put-retention-policy --log-group-name y');
});

test('引用符ごしのサービス名でも見る', () => {
  denies('aws "logs" delete-log-group --log-group-name y');
  denies("aws 'logs' delete-log-group --log-group-name y");
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
