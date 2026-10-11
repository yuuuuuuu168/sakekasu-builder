import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import { IDENTITY_TOKEN_AUDIENCE } from './llm-constants.js';

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
 *
 * 例外は 1 つだけある。Claude API に API キーなしで入るため（Workload Identity Federation）、
 * OCR とテイスティングノートのロールは `sts:GetWebIdentityToken` を要求する。境界はこれを
 * 宛先が Anthropic の場合に限って通す（下の DenySecurityTokenServiceExceptIdentityTokens）。
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
        actions: ['iam:*', 'organizations:*', 'account:*'],
        resources: ['*'],
      }),
      // STS も同じく拒否するが、Claude API に入るための ID トークン（JWT）の取得だけは通す
      // （OCR とテイスティングノート。lambda/shared/llm.ts）。
      //
      // 開けるのは GetWebIdentityToken だけで、宛先が Anthropic のものに限る。AssumeRole など
      // 別のロールの権限を得る操作は、これまでどおり天井から外れたまま。宛先を絞るので、
      // このロールを乗っ取っても AWS や他のサービスに入る JWT は作れない。作れた JWT で入れるのは
      // Claude Console のルールが認めたワークスペースの推論だけになる。
      //
      // 書き方を 2 つに分けているのは、「sts:* から 1 つだけ除く」を列挙で書くと、
      // AWS が STS に操作を足したときにそれが素通りする（fail-open）ため。
      // 1 つ目は宛先の条件キーを持たない操作をすべて拒否する。この条件キーを持つのは
      // GetWebIdentityToken だけなので、新しい操作も含めて残りはすべてここで止まる
      new iam.PolicyStatement({
        sid: 'DenySecurityTokenServiceExceptIdentityTokens',
        effect: iam.Effect.DENY,
        actions: ['sts:*'],
        resources: ['*'],
        conditions: {
          Null: { 'sts:IdentityTokenAudience': 'true' },
        },
      }),
      // 2 つ目は、宛先に Anthropic 以外が 1 つでも混ざった ID トークンの取得を拒否する
      new iam.PolicyStatement({
        sid: 'DenyIdentityTokensForOtherAudiences',
        effect: iam.Effect.DENY,
        actions: ['sts:GetWebIdentityToken'],
        resources: ['*'],
        conditions: {
          'ForAnyValue:StringNotEquals': {
            'sts:IdentityTokenAudience': [IDENTITY_TOKEN_AUDIENCE],
          },
        },
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
