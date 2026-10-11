import { describe, it, expect, beforeAll } from 'vitest';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { GithubOidcStack } from '../lib/github-oidc-stack.js';

const REPOSITORY = 'yuuuuuuu168/sakekasu-builder';
const ACCOUNT = '111111111111';
const SITE_ZONE = 'sake.sakekasu-builder.com';

function synth(): Template {
  const app = new cdk.App();
  const stack = new GithubOidcStack(app, 'TestGithubOidc', {
    repository: REPOSITORY,
    siteZone: SITE_ZONE,
    env: { account: ACCOUNT, region: 'ap-northeast-1' },
  });
  return Template.fromStack(stack);
}

const ROLE_BOUNDARY_ARN = `arn:aws:iam::${ACCOUNT}:policy/sakekasu-role-boundary`;

interface Statement {
  Sid?: string;
  Effect: 'Allow' | 'Deny';
  Action: string | string[];
  Resource: string | string[];
  Condition?: Record<string, Record<string, string | string[]>>;
}

function toArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

/** 指定したロールに付いている AWS::IAM::Policy の全ステートメントを集める */
function statementsFor(template: Template, roleLogicalId: RegExp): Statement[] {
  const policies = template.findResources('AWS::IAM::Policy');
  return Object.values(policies)
    .map((p) => (p as { Properties: { Roles?: unknown[]; PolicyDocument: { Statement: Statement[] } } }).Properties)
    .filter((props) =>
      (props.Roles ?? []).some(
        (r) => typeof r === 'object' && r !== null && 'Ref' in r &&
          roleLogicalId.test((r as { Ref: string }).Ref),
      ),
    )
    .flatMap((props) => props.PolicyDocument.Statement);
}

/**
 * ポリシーのアクション表記を正規表現に直す。
 *
 * IAM のワイルドカードは `*`（0文字以上）と `?`（ちょうど1文字）の2つ。
 * 素朴に `*` だけを `.*` へ置き換えると、`?` が正規表現の「直前の文字が
 * 0個か1個」として解釈され、意味が変わる。`iam:PassRol?` が
 * `iam:PassRole` に当たらない（取りこぼし）だけでなく、書き方によっては
 * 逆に当たってしまう（見逃し）。
 *
 * 見逃す側が問題で、Deny を検査するテストが「塞げていないのに緑」になる。
 * ここは `denies()` が唯一の担保になっている StartDiscovery の検査に
 * 効いてくる（PR #161 のレビュー指摘）。
 *
 * エスケープは展開より先に行う。順番が逆だと、エスケープ用に足した
 * バックスラッシュまでワイルドカードとして展開してしまう。
 */
function iamActionToRegex(action: string): RegExp {
  const escaped = action.replace(/[.+[\](){}^$|\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
}

/** そのステートメントが、指定の効果でそのアクションに当たるか */
function matches(statement: Statement, effect: 'Allow' | 'Deny', action: string): boolean {
  if (statement.Effect !== effect) return false;
  return toArray(statement.Action).some((a) => iamActionToRegex(a).test(action));
}

/**
 * そのアクションが許可されているか。ポリシーはワイルドカード（`appsync:*`）を
 * 使うため、文字列の一致ではなくパターンとして評価する
 */
function allows(statements: Statement[], action: string): boolean {
  return statements.some((s) => matches(s, 'Allow', action));
}

/**
 * そのアクションを明示的に拒否しているか。`allows` の Deny 版。
 *
 * 「Allow に入っていない」と「Deny で塞いである」は別物。前者は誰かが
 * Allow を広げた瞬間に消えるが、後者は残る
 */
function denies(statements: Statement[], action: string): boolean {
  return statements.some((s) => matches(s, 'Deny', action));
}

// 下のテスト群はこの判定に乗っている。ここが取りこぼすと、権限が広がっても
// Deny が消えても緑のままになる
describe('アクション表記の判定', () => {
  const on = (action: string) => [{ Effect: 'Allow' as const, Action: [action], Resource: '*' }];

  it('ワイルドカードを展開する', () => {
    for (const pattern of ['s3:GetObject', 's3:Get*', 's3:*', '*']) {
      expect(allows(on(pattern), 's3:GetObject'), `${pattern} を取りこぼしている`).toBe(true);
    }
  });

  it('? はちょうど1文字として扱う', () => {
    expect(allows(on('iam:PassRol?'), 'iam:PassRole'), '? が1文字に当たらない').toBe(true);
    // 「直前の文字が0個か1個」と解釈されると、これが通ってしまう
    expect(allows(on('iam:PassRole?'), 'iam:PassRole'), '? が0文字に当たっている').toBe(false);
  });

  it('ワイルドカード以外のメタ文字は文字として扱う', () => {
    expect(allows(on('s3:Get.bject'), 's3:GetObject')).toBe(false);
    expect(allows(on('s3:GetObject+'), 's3:GetObject')).toBe(false);
  });

  it('効果を取り違えない', () => {
    const deny = [{ Effect: 'Deny' as const, Action: ['s3:*'], Resource: '*' }];

    expect(allows(deny, 's3:GetObject'), 'Deny を許可として数えている').toBe(false);
    expect(denies(deny, 's3:GetObject')).toBe(true);
    expect(denies(on('s3:*'), 's3:GetObject'), 'Allow を拒否として数えている').toBe(false);
  });
});

describe('GithubOidcStack', () => {
  let template: Template;

  beforeAll(() => {
    template = synth();
  });

  it('deploy ロールは main ブランチの push からしか引き受けられない', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'sakekasu-github-actions-deploy',
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: Match.objectLike({
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
              }),
              StringLike: {
                'token.actions.githubusercontent.com:sub': [
                  `repo:yuuuuuuu168@*/sakekasu-builder@*:ref:refs/heads/main`,
                  `repo:${REPOSITORY}:ref:refs/heads/main`,
                ],
              },
            },
          }),
        ]),
      },
    });
  });

  it('deploy ロールの実権限は AssumeRole だけ（自分では何も作れない）', () => {
    // CdkdDeployRole も論理 ID に DeployRole を含むため、明示的に除く
    const statements = statementsFor(template, /^DeployRole/);

    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement.Effect).toBe('Allow');
      expect(toArray(statement.Action)).toEqual(['sts:AssumeRole']);
    }

    const targets = statements.flatMap((s) => toArray(s.Resource));
    // 移行が終わるまでは CDK CLI も使うため、bootstrap ロールへの経路は残す
    expect(targets).toContain(`arn:aws:iam::${ACCOUNT}:role/cdk-hnb659fds-*`);
  });

  it('deploy ロールは cdkd のデプロイロールへ入れる', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      Roles: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('^DeployRole') })]),
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Resource: {
              'Fn::GetAtt': Match.arrayWith([Match.stringLikeRegexp('^CdkdDeployRole')]),
            },
          }),
        ]),
      },
    });
  });

  it('diff ロールは pull_request からのみで、CDK bootstrap のロールには入れない', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'sakekasu-github-actions-diff',
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: {
              StringEquals: Match.objectLike({
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
              }),
              StringLike: {
                'token.actions.githubusercontent.com:sub': [
                  `repo:yuuuuuuu168@*/sakekasu-builder@*:pull_request`,
                  `repo:${REPOSITORY}:pull_request`,
                ],
              },
            },
          }),
        ]),
      },
    });
    // cdk-diff.yml が cdkd diff に切り替わり、lookup ロールは使われなくなった。
    // cdkd は自分の認証情報で読むので、AssumeRole 自体を持たない
    const statements = statementsFor(template, /^DiffRole/);
    expect(statements.length).toBeGreaterThan(0);
    expect(allows(statements, 'sts:AssumeRole'), 'diff ロールが AssumeRole を持っている').toBe(
      false,
    );
    const targets = statements.flatMap((s) => toArray(s.Resource));
    expect(targets).not.toContain(`arn:aws:iam::${ACCOUNT}:role/cdk-hnb659fds-lookup-role-*`);
  });

  it('diff ロールは cdkd のアセット保管庫を確かめられる', () => {
    // cdkd は diff でもリージョンのアセット保管庫が自分のものかを
    // HeadBucket（ExpectedBucketOwner 付き）で確かめる。権限が無いと 403 が
    // 返り、cdkd はそれを「他アカウントのバケット」と解釈して止まる。
    // 権限不足が乗っ取りに見えるエラーになるので、原因が分かりにくい（PR #230）
    const statements = statementsFor(template, /^DiffRole/);
    const probe = statements.filter(
      (s) =>
        s.Effect === 'Allow' &&
        toArray(s.Action).includes('s3:ListBucket') &&
        toArray(s.Resource).includes(`arn:aws:s3:::cdkd-assets-${ACCOUNT}-*`),
    );

    expect(
      probe.length,
      'cdkd-assets-* への s3:ListBucket が無い。cdkd diff が ' +
        'ASSET_STORAGE_FOREIGN_BUCKET で落ちる',
    ).toBeGreaterThan(0);

    // 中身を読む権限は足さない
    for (const statement of probe) {
      expect(toArray(statement.Action), 'アセットの中身を読む権限が付いている').not.toContain(
        's3:GetObject',
      );
    }
  });

  it('diff ロールには書き込み権限が一切ない', () => {
    const statements = statementsFor(template, /^DiffRole/);
    expect(statements.length).toBeGreaterThan(0);

    for (const action of [
      'lambda:UpdateFunctionCode',
      'lambda:CreateFunction',
      'dynamodb:PutItem',
      'dynamodb:UpdateTable',
      's3:PutObject',
      's3:DeleteObject',
      'iam:PutRolePolicy',
      'iam:CreateRole',
      'cognito-idp:UpdateUserPool',
      'cloudformation:CreateResource',
      'cloudformation:UpdateResource',
      'cloudformation:DeleteStack',
      'route53:ChangeResourceRecordSets',
      'route53:CreateHostedZone',
      'acm:RequestCertificate',
      'cloudfront:UpdateDistribution',
      'cloudfront:CreateInvalidation',
    ]) {
      expect(allows(statements, action), `${action} が許可されている`).toBe(false);
    }
  });

  it('diff ロールは読み取りでも利用者のデータには届かない', () => {
    const statements = statementsFor(template, /^DiffRole/);
    expect(statements.length).toBeGreaterThan(0);

    // ログには画像キー経由で Cognito の sub が入りうる（lib/log-retention.ts）
    for (const action of [
      'logs:GetLogEvents',
      'logs:FilterLogEvents',
      'dynamodb:GetItem',
      'dynamodb:Query',
      'dynamodb:Scan',
      'cognito-idp:ListUsers',
      'cognito-idp:AdminGetUser',
    ]) {
      expect(allows(statements, action), `${action} が許可されている`).toBe(false);
    }

    // s3:GetObject は cdkd の state バケットにだけ許す。画像バケットには許さない
    const objectReaders = statements.filter(
      (s) => s.Effect === 'Allow' && toArray(s.Action).includes('s3:GetObject'),
    );
    expect(objectReaders.length).toBeGreaterThan(0);
    for (const statement of objectReaders) {
      for (const resource of toArray(statement.Resource)) {
        expect(resource).toContain(`cdkd-state-${ACCOUNT}`);
      }
    }
  });

  it('cdkd のデプロイロールは deploy ロールからしか引き受けられない', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'sakekasu-cdkd-deploy',
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: 'sts:AssumeRole',
            Principal: {
              AWS: { 'Fn::GetAtt': Match.arrayWith([Match.stringLikeRegexp('^DeployRole')]) },
            },
          }),
        ],
      },
    });
  });

  it('cdkd のデプロイロールは OIDC 連携のロール自身を書き換えられない', () => {
    const statements = statementsFor(template, /^CdkdDeployRole/);
    const deny = statements.find(
      (s) =>
        s.Effect === 'Deny' &&
        toArray(s.Resource).includes(`arn:aws:iam::${ACCOUNT}:role/sakekasu-cdkd-deploy`),
    );

    expect(deny, 'Deny ステートメントが無い').toBeDefined();
    expect(toArray(deny!.Action)).toContain('iam:*');
    expect(toArray(deny!.Resource)).toEqual(
      expect.arrayContaining([
        `arn:aws:iam::${ACCOUNT}:role/sakekasu-cdkd-deploy`,
        `arn:aws:iam::${ACCOUNT}:role/sakekasu-github-actions-deploy`,
        `arn:aws:iam::${ACCOUNT}:role/sakekasu-github-actions-diff`,
      ]),
    );
  });

  it('cdkd のデプロイロールはロールの権限を境界の内側でしか書き換えられない', () => {
    const statements = statementsFor(template, /^CdkdDeployRole/);

    // 権限を増やしうる IAM の API は、すべて境界の条件付きでなければならない。
    // 1つでも素通しがあると、Lambda の実行ロールに管理者相当を書き込んで
    // その関数を呼ぶ、という昇格の連鎖が通ってしまう
    const escalating = [
      'iam:CreateRole',
      'iam:PutRolePolicy',
      'iam:AttachRolePolicy',
      'iam:PutRolePermissionsBoundary',
    ];
    for (const action of escalating) {
      const granting = statements.filter(
        (s) => s.Effect === 'Allow' && toArray(s.Action).includes(action),
      );
      expect(granting.length, `${action} を許可するステートメントが無い`).toBeGreaterThan(0);
      for (const statement of granting) {
        expect(
          statement.Condition?.ArnEquals?.['iam:PermissionsBoundary'],
          `${action} に境界の条件が無い`,
        ).toBe(ROLE_BOUNDARY_ARN);
      }
    }
  });

  // cdkd はロールを消すとき、GetRole → 管理ポリシーを外す → インラインポリシーを消す →
  // インスタンスプロファイルから外す → DeleteRole の順に呼ぶ。どれか 1 つでも許可が欠けると、
  // ロールを作り替えたデプロイが古いロールを消す段で止まる。その時点で古いロールの権限は
  // 先に消えていて巻き戻せないため、関数がロールの権限なしで残る
  // （2026-10-11、iam:ListInstanceProfilesForRole が無くて実際に起きた）
  it('cdkd のデプロイロールはアプリのロールを最後まで消せる', () => {
    const statements = statementsFor(template, /^CdkdDeployRole/);
    for (const action of [
      'iam:GetRole',
      'iam:ListAttachedRolePolicies',
      'iam:DetachRolePolicy',
      'iam:ListRolePolicies',
      'iam:DeleteRolePolicy',
      'iam:ListInstanceProfilesForRole',
      'iam:DeleteRole',
    ]) {
      const granting = statements.filter(
        (s) =>
          s.Effect === 'Allow' &&
          toArray(s.Action).includes(action) &&
          toArray(s.Resource).includes(`arn:aws:iam::${ACCOUNT}:role/sakekasu-*`),
      );
      expect(granting.length, `${action} がアプリのロールに許可されていない`).toBeGreaterThan(0);
    }
  });

  it('cdkd のデプロイロールは信頼ポリシーを書き換えられない', () => {
    const statements = statementsFor(template, /^CdkdDeployRole/);

    // 信頼ポリシーを書き換えられると「誰がそのロールになれるか」を変えられる。
    // 外部アカウントを信頼先に足してロールを乗っ取れば、境界が拒否しない
    // DynamoDB や S3 には届いてしまう。iam:PermissionsBoundary はこの
    // アクションに渡らないため、条件で縛ることもできない
    expect(allows(statements, 'iam:UpdateAssumeRolePolicy')).toBe(false);

    // 「Allow に無い」だけだと、誰かが Allow を広げた瞬間に消える。
    // Deny で全ロールを塞いであることまで確かめる（Issue #156）
    // OIDC 連携のロールだけを塞ぐ iam:* の Deny も当たるので、対象が全ロールのものを探す
    const deniedResources = statements
      .filter((s) => matches(s, 'Deny', 'iam:UpdateAssumeRolePolicy') && s.Condition === undefined)
      .flatMap((s) => toArray(s.Resource));
    expect(deniedResources).toContain(`arn:aws:iam::${ACCOUNT}:role/*`);
  });

  it('cdkd のデプロイロールは境界を外せない', () => {
    const statements = statementsFor(template, /^CdkdDeployRole/);

    expect(allows(statements, 'iam:DeleteRolePermissionsBoundary')).toBe(false);

    const denied = statements
      .filter((s) => s.Effect === 'Deny')
      .flatMap((s) => toArray(s.Action));
    expect(denied).toContain('iam:DeleteRolePermissionsBoundary');

    // 境界そのものの中身を書き換えられても意味が無くなる
    const rewriting = statements.find(
      (s) => s.Effect === 'Deny' && toArray(s.Resource).includes(ROLE_BOUNDARY_ARN),
    );
    expect(rewriting, '境界ポリシーの書き換えを塞ぐ Deny が無い').toBeDefined();
    expect(toArray(rewriting!.Action)).toContain('iam:CreatePolicyVersion');
  });

  it('PassRole は実際に使うサービスにしか渡せない', () => {
    const statements = statementsFor(template, /^CdkdDeployRole/);
    const passRole = statements.filter(
      (s) => s.Effect === 'Allow' && toArray(s.Action).includes('iam:PassRole'),
    );

    expect(passRole.length).toBe(1);
    // iam:PassedToService は PassRole 専用の条件キー。他のアクションと同居
    // させると、そちらが常に拒否される
    expect(toArray(passRole[0].Action)).toEqual(['iam:PassRole']);
    expect(toArray(passRole[0].Condition!.StringEquals['iam:PassedToService'])).toEqual([
      'lambda.amazonaws.com',
      'appsync.amazonaws.com',
      'events.amazonaws.com',
    ]);
  });

  // SLO は Cloud Control API 経由で作られるが、その先で
  // applicationsignals:CreateServiceLevelObjective が呼ばれる。
  // cloudformation:CreateResource だけでは AccessDenied で落ちる
  it('cdkd のデプロイロールは SLO を作れる', () => {
    const statements = statementsFor(template, /^CdkdDeployRole/);

    expect(allows(statements, 'applicationsignals:CreateServiceLevelObjective')).toBe(true);
    expect(allows(statements, 'applicationsignals:TagResource')).toBe(true);
  });

  // サービス検出はアカウントに1つの設定で、スタックから外して守っている。
  // 一度これを消しかけてソムリエの可観測性を道連れにしている。
  // applicationsignals:* にすると IAM の側から素通りで触れてしまう
  it('cdkd のデプロイロールはサービス検出を有効化できない', () => {
    const statements = statementsFor(template, /^CdkdDeployRole/);

    expect(allows(statements, 'applicationsignals:StartDiscovery')).toBe(false);

    // Allow が広がっても効くように Deny も置いてある
    expect(
      denies(statements, 'applicationsignals:StartDiscovery'),
      'StartDiscovery を拒否するステートメントが無い',
    ).toBe(true);
  });

  // SLO をデプロイした後、PR で cdkd diff が既存の状態を読みにいく。
  // 読めないと差分を出す前に AccessDenied で落ちる
  it('diff ロールは SLO を読める', () => {
    const statements = statementsFor(template, /^DiffRole/);

    expect(allows(statements, 'applicationsignals:GetServiceLevelObjective')).toBe(true);
    expect(allows(statements, 'applicationsignals:ListServiceLevelObjectives')).toBe(true);
  });

  // diff ロールは読み取り専用。SLO も例外ではない
  it('diff ロールは SLO を書き換えられない', () => {
    const statements = statementsFor(template, /^DiffRole/);

    for (const action of [
      'applicationsignals:CreateServiceLevelObjective',
      'applicationsignals:UpdateServiceLevelObjective',
      'applicationsignals:DeleteServiceLevelObjective',
      'applicationsignals:StartDiscovery',
    ]) {
      expect(allows(statements, action), `${action} が許可されている`).toBe(false);
    }
  });

  it('cdkd のデプロイロールはログの中身を読めない', () => {
    const statements = statementsFor(template, /^CdkdDeployRole/);

    for (const action of [
      'logs:GetLogEvents',
      'logs:FilterLogEvents',
      'logs:StartQuery',
      'logs:GetQueryResults',
      'logs:StartLiveTail',
    ]) {
      expect(allows(statements, action), `${action} が許可されている`).toBe(false);
    }

    // ロググループの管理そのものはできる必要がある
    expect(allows(statements, 'logs:PutRetentionPolicy')).toBe(true);
    expect(allows(statements, 'logs:PutMetricFilter')).toBe(true);
  });

  // Cognito のリソースを持っていたのは旧ユーザープール（sakekasu-dev-auth）だけで、
  // アプリから外した。main への push から届く権限に、ユーザープールを作り替えたり
  // 消したりできる権限を残さない
  it('cdkd のデプロイロールは Cognito を読むだけで、作り替えも削除もできない', () => {
    const statements = statementsFor(template, /^CdkdDeployRole/);
    expect(statements.length).toBeGreaterThan(0);

    for (const action of [
      'cognito-idp:CreateUserPool',
      'cognito-idp:UpdateUserPool',
      'cognito-idp:DeleteUserPool',
      'cognito-idp:CreateUserPoolClient',
      'cognito-idp:UpdateUserPoolClient',
      'cognito-idp:DeleteUserPoolClient',
    ]) {
      expect(allows(statements, action), `${action} が許可されている`).toBe(false);
    }
    expect(allows(statements, 'cognito-idp:DescribeUserPool')).toBe(true);
  });

  it('cdkd のデプロイロールは利用者のデータを読めない', () => {
    const statements = statementsFor(template, /^CdkdDeployRole/);
    expect(statements.length).toBeGreaterThan(0);

    for (const action of [
      'dynamodb:GetItem',
      'dynamodb:Query',
      'dynamodb:Scan',
      'cognito-idp:ListUsers',
      'cognito-idp:AdminGetUser',
    ]) {
      expect(allows(statements, action), `${action} が許可されている`).toBe(false);
    }

    // 画像バケットはバケットの設定だけ。オブジェクトには触らせない
    const objectWriters = statements.filter(
      (s) =>
        s.Effect === 'Allow' &&
        toArray(s.Action).some((a) => /^s3:(GetObject|PutObject|DeleteObject|\*)$/.test(a)),
    );
    for (const statement of objectWriters) {
      for (const resource of toArray(statement.Resource)) {
        expect(resource).toMatch(/cdkd-(state|assets)-/);
      }
    }
  });

  it('cdkd のデプロイロールは AdministratorAccess を貼っていない', () => {
    const roles = template.findResources('AWS::IAM::Role', {
      Properties: { RoleName: 'sakekasu-cdkd-deploy' },
    });
    const managed = Object.values(roles).flatMap(
      (r) => (r as { Properties: { ManagedPolicyArns?: unknown[] } }).Properties.ManagedPolicyArns ?? [],
    );
    expect(managed).toEqual([]);
  });

  it('配信用ロールは main ブランチの push からしか引き受けられない', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'sakekasu-github-actions-site',
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: Match.objectLike({
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
              }),
              StringLike: {
                'token.actions.githubusercontent.com:sub': [
                  `repo:yuuuuuuu168@*/sakekasu-builder@*:ref:refs/heads/main`,
                  `repo:${REPOSITORY}:ref:refs/heads/main`,
                ],
              },
            },
          }),
        ]),
      },
    });
  });

  it('配信用ロールは配信バケットの中身を置き換えるだけ', () => {
    const statements = statementsFor(template, /^SiteDeployRole/);
    expect(statements.length).toBeGreaterThan(0);

    for (const statement of statements) {
      expect(statement.Effect).toBe('Allow');
      for (const action of toArray(statement.Action)) {
        expect(['s3:ListBucket', 's3:PutObject', 's3:DeleteObject']).toContain(action);
      }
      for (const resource of toArray(statement.Resource)) {
        expect(resource).toMatch(new RegExp(`^arn:aws:s3:::\\*-sakekasu-site-${ACCOUNT}(/\\*)?$`));
      }
    }
    // cdkd のロールにも bootstrap のロールにも入れない
    expect(allows(statements, 'sts:AssumeRole')).toBe(false);
  });

  it('cdkd のデプロイロールは配信用サブドメインの DNS レコードしか書き換えられない', () => {
    const statements = statementsFor(template, /^CdkdDeployRole/);
    const writers = statements.filter((s) => matches(s, 'Allow', 'route53:ChangeResourceRecordSets'));
    expect(writers.length).toBeGreaterThan(0);

    for (const statement of writers) {
      // 同じアカウントに kakeibo・learning・reinvent のゾーンもある。名前で絞らないと
      // 他のアプリのサブドメインを書き換えられる
      expect(statement.Condition).toEqual({
        'ForAllValues:StringLike': {
          'route53:ChangeResourceRecordSetsNormalizedRecordNames': [SITE_ZONE, `*.${SITE_ZONE}`],
        },
      });
    }
  });

  it('cdkd のデプロイロールはゾーンを消せず、キャッシュの無効化も打てない', () => {
    const statements = statementsFor(template, /^CdkdDeployRole/);
    expect(allows(statements, 'route53:DeleteHostedZone')).toBe(false);
    expect(allows(statements, 'cloudfront:CreateInvalidation')).toBe(false);
  });

  it('OIDC 連携のロールは1つ残らず Deny の対象になっている', () => {
    const statements = statementsFor(template, /^CdkdDeployRole/);
    const denied = statements
      .filter((s) => s.Effect === 'Deny')
      .flatMap((s) => toArray(s.Resource));

    // このスタックがロールを増やしたら、Deny にも足す必要がある。
    // 足し忘れると、そのロールを cdkd のデプロイロールから書き換えられる
    //
    // roleName を明示していないロールは名前が合成結果に出ず、Deny に入れようがない。
    // 黙って飛ばすと網羅から漏れても緑のままなので、落とす（Issue #156）。
    //
    // 例外は OpenIdConnectProvider がカスタムリソースとして作る Lambda の実行ロールだけ。
    // CDK が名前を決めるため付けられず、自動命名はスタック名（sakekasu-github-oidc-*）で
    // 始まる。cdkd のデプロイロールの IAM 系の許可は sakekasu-dev-* などアプリの接頭辞に
    // 限られ、それ以外はガードレールの DenyRolesOutsideApp が拒否するので、触れない
    const UNNAMED_ROLES_OUT_OF_REACH = [/^CustomAWSCDKOpenIdConnectProviderCustomResourceProviderRole/];
    const roles = Object.entries(template.findResources('AWS::IAM::Role')).flatMap(
      ([logicalId, r]) => {
        const name = (r as { Properties: { RoleName?: unknown } }).Properties.RoleName;
        if (typeof name !== 'string' && UNNAMED_ROLES_OUT_OF_REACH.some((p) => p.test(logicalId))) {
          return [];
        }
        if (typeof name !== 'string') {
          throw new Error(
            `roleName を明示していないロールがある: ${logicalId}。` +
              'Deny の対象に入れられないので、名前を付けること',
          );
        }
        return [name];
      },
    );

    expect(roles.length).toBeGreaterThan(0);
    for (const roleName of roles) {
      expect(denied, `${roleName} が Deny に入っていない`).toContain(
        `arn:aws:iam::${ACCOUNT}:role/${roleName}`,
      );
    }
  });

  // cdkd は「作成時にしか指定できないプロパティ」を cloudformation:DescribeType で
  // 型ごとに引く。読めないと同梱のスキーマ写しに落ち、AWS 側で更新可能になった
  // プロパティを差し替えと誤判定しうる。PR #230 の cdkd diff が実際に
  // 「Grant cloudformation:DescribeType to use the live schema」を出した
  it.each([
    ['cdkd のデプロイロール', /^CdkdDeployRole/],
    ['diff ロール', /^DiffRole/],
  ])('%s は型スキーマを引ける', (_label, logicalId) => {
    const statements = statementsFor(template, logicalId);
    expect(statements.length).toBeGreaterThan(0);

    expect(
      allows(statements, 'cloudformation:DescribeType'),
      'DescribeType が無いと同梱のスキーマ写しに落ちる',
    ).toBe(true);
  });

  it.each([
    ['cdkd のデプロイロール', /^CdkdDeployRole/],
    ['diff ロール', /^DiffRole/],
  ])('%s の型スキーマ参照は型だけに絞ってある', (_label, logicalId) => {
    // DescribeType は公開された型のスキーマを読むだけ。リソースの中身には
    // 関係しないので、ワイルドカードを広げる理由がない
    const statements = statementsFor(template, logicalId).filter(
      (st) => st.Effect !== 'Deny' && toArray(st.Action).includes('cloudformation:DescribeType'),
    );
    expect(statements.length, 'DescribeType を許可する文が無い').toBeGreaterThan(0);

    for (const statement of statements) {
      for (const resource of toArray(statement.Resource)) {
        expect(resource, 'DescribeType のリソースが絞られていない').toMatch(
          /^arn:aws:cloudformation:[^:]*::type\/resource\//,
        );
      }
    }
  });

  it('OIDC プロバイダーは GitHub Actions のトークン発行元を指す', () => {
    // OpenIdConnectProvider はカスタムリソースとして合成される
    const providers = template.findResources('Custom::AWSCDKOpenIdConnectProvider');
    const urls = Object.values(providers).map(
      (p) => (p as { Properties: { Url: string } }).Properties.Url,
    );
    expect(urls).toContain('https://token.actions.githubusercontent.com');
  });

  describe('cdkd のデプロイロールのガードレール', () => {
    function guardrail(): { Properties: { Roles: unknown[]; PolicyDocument: { Statement: Statement[] } } } {
      const policies = Object.values(
        template.findResources('AWS::IAM::ManagedPolicy', {
          Properties: { ManagedPolicyName: 'sakekasu-cdkd-deploy-guardrail' },
        }),
      );
      expect(policies).toHaveLength(1);
      return policies[0] as ReturnType<typeof guardrail>;
    }
    const statement = (sid: string): Statement => {
      const found = guardrail().Properties.PolicyDocument.Statement.find((s) => s.Sid === sid);
      expect(found, sid).toBeDefined();
      return found as Statement;
    };

    it('cdkd のデプロイロールにだけ付き、中身は Deny だけ', () => {
      expect(guardrail().Properties.Roles).toEqual([{ Ref: expect.stringMatching(/^CdkdDeployRole/) }]);
      expect(guardrail().Properties.PolicyDocument.Statement.every((s) => s.Effect === 'Deny')).toBe(true);
    });

    it('他のアプリの App タグが付いたリソースと、他のアプリの App タグの付与を拒否する', () => {
      expect(statement('DenyOtherAppsResources').Condition).toEqual({
        Null: { 'aws:ResourceTag/App': 'false' },
        StringNotEquals: { 'aws:ResourceTag/App': 'builder' },
      });
      expect(statement('DenyForeignAppTag').Condition).toEqual({
        Null: { 'aws:RequestTag/App': 'false' },
        StringNotEquals: { 'aws:RequestTag/App': 'builder' },
      });
    });

    it('sakekasu-* のうち、builder の環境の接頭辞の外にあるロールは作り替えられない', () => {
      const notResource = (statement('DenyRolesOutsideApp') as Statement & { NotResource: string[] }).NotResource;
      expect(notResource).toEqual(
        ['dev', 'staging', 'prod'].flatMap((env) => [
          `arn:aws:iam::${ACCOUNT}:role/sakekasu-${env}-*`,
          `arn:aws:iam::${ACCOUNT}:policy/sakekasu-${env}-*`,
        ]),
      );
    });

    it('他のアプリの cdkd の状態は書き換えられず、builder の状態は対象に入らない', () => {
      const resources = toArray(statement('DenyWritingOtherAppsState').Resource);
      expect(resources).toContain(`arn:aws:s3:::cdkd-state-${ACCOUNT}/cdkd/sakekasu-kakeibo*`);
      expect(resources).toContain(`arn:aws:s3:::cdkd-state-${ACCOUNT}/cdkd/ReinventPlanner*`);
      expect(resources.some((r) => /cdkd\/sakekasu-(dev|staging|prod)/.test(r))).toBe(false);
    });

    // 資産置き場のキーは中身のハッシュだけで、アプリで分けられない。削除は全部止める
    it('共用の資産置き場は消せず、設定も変えられない', () => {
      const s = statement('DenyDestroyingSharedAssets');
      // ライフサイクルでの期限切れやポリシーの差し替えは、削除と同じ結果になる
      // 状態バケットと同じ設定変更（暗号化、レプリケーション、公開設定など）も止める
      const actions = toArray(s.Action);
      expect(actions).toEqual(expect.arrayContaining(['s3:DeleteObject', 's3:DeleteObjectVersion']));
      expect(actions).toEqual(expect.arrayContaining(toArray(statement('DenyChangingCdkdStateBucket').Action)));
      expect(toArray(s.Resource)).toEqual([
        `arn:aws:s3:::cdkd-assets-${ACCOUNT}-*`,
        `arn:aws:s3:::cdk-hnb659fds-assets-${ACCOUNT}-*`,
      ]);
    });
  });
});
