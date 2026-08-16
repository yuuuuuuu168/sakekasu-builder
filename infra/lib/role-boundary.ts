import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

/**
 * アプリのロールに付ける Permissions Boundary（Issue #150）。
 *
 * cdkd のデプロイロールは、アプリのロール（Lambda・AppSync・EventBridge の
 * 実行ロール）を作り替える必要がある。ロール名はスタック名が接頭辞に付くので
 * `sakekasu-*` に閉じられるが、それだけでは権限昇格が塞げない:
 *
 *   1. `iam:PutRolePolicy` で Lambda の実行ロールに管理者相当を書き込む
 *   2. `lambda:UpdateFunctionConfiguration` でそのロールを使う関数にする
 *   3. `lambda:InvokeFunction` で呼ぶ
 *
 * これで main への push を起点に任意の API を叩ける。PR #151 のセキュリティ
 * レビューで指摘された経路がこれ。
 *
 * 境界を付けると、ロールの実効権限は「アイデンティティポリシー ∩ 境界」に
 * なる。手順1で管理者相当を書き込まれても、境界が `iam:*` を拒否している
 * 限り、そのロールから IAM を触ることはできない。
 *
 * 境界は「許可の上限」であって許可そのものではないため、`Allow *` を置いても
 * ロールの権限は増えない。増えないほうに効くのが Deny の側で、ここを
 * 最小限（昇格に使える IAM と STS だけ）に絞ることで、アプリの動作には
 * 一切影響させずに昇格の連鎖だけを切る。
 *
 * 合成した4スタックのポリシーを全部走査して、`iam:` `sts:` `organizations:`
 * `account:` で始まるアクションを要求しているロールが1つも無いことは確認済み。
 */

/** 境界ポリシーの名前。ARN を名前から組み立てるため、値を変えると再作成になる */
export const ROLE_BOUNDARY_NAME = 'sakekasu-role-boundary';

/** 指定アカウントにおける境界ポリシーの ARN */
export function roleBoundaryArn(account: string): string {
  return `arn:aws:iam::${account}:policy/${ROLE_BOUNDARY_NAME}`;
}

/**
 * 境界ポリシーの本体を作る。`GithubOidcStack` からのみ呼ぶ。
 *
 * アプリのスタックより先に存在している必要がある（境界が無いロールに対して
 * cdkd が `iam:PutRolePolicy` を打つと、条件が一致せず AccessDenied になる）。
 */
export function createRoleBoundary(scope: Construct, id: string): iam.ManagedPolicy {
  return new iam.ManagedPolicy(scope, id, {
    managedPolicyName: ROLE_BOUNDARY_NAME,
    description: 'Ceiling for roles created by the cdkd deploy role (no IAM/STS escalation)',
    statements: [
      // 境界は許可を与えない。ここを絞ってもアプリの権限は増えも減りもせず、
      // 実効権限は各ロール自身のポリシーとの積で決まる
      new iam.PolicyStatement({
        sid: 'AllowUpToTheCeiling',
        actions: ['*'],
        resources: ['*'],
      }),
      // 昇格に使えるものだけを天井から外す。アプリのロールはどれも
      // これらを要求していない
      new iam.PolicyStatement({
        sid: 'DenyIdentityAndOrganizationControl',
        effect: iam.Effect.DENY,
        actions: ['iam:*', 'sts:*', 'organizations:*', 'account:*'],
        resources: ['*'],
      }),
    ],
  });
}

/**
 * スタック内で作られるロールすべてに境界を適用する。
 *
 * `GithubOidcStack` には適用しない。cdkd のデプロイロール自身に境界が付くと
 * `iam:*` が拒否され、アプリのロールを作れなくなる。
 */
export function applyRoleBoundary(stack: cdk.Stack): void {
  const boundary = iam.ManagedPolicy.fromManagedPolicyName(
    stack,
    'RoleBoundary',
    ROLE_BOUNDARY_NAME,
  );
  iam.PermissionsBoundary.of(stack).apply(boundary);
}
