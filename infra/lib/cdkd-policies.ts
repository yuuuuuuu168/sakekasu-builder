import * as iam from 'aws-cdk-lib/aws-iam';
import { roleBoundaryArn } from './role-boundary.js';

/**
 * ロールを渡す先のサービス。合成した4スタックの信頼ポリシーを走査した結果、
 * この3つしか出てこない（Issue #150 のレビュー指摘への対応）
 */
const PASS_ROLE_TARGET_SERVICES = [
  'lambda.amazonaws.com',
  'appsync.amazonaws.com',
  'events.amazonaws.com',
];

/**
 * CloudWatch Logs のデータプレーン。ログ本文には画像キー経由で利用者の
 * Cognito sub が入りうる（lib/log-retention.ts）ため、デプロイロールにも
 * 渡さない。列挙し漏らしたときの保険として Deny でも塞ぐ
 */
const LOGS_DATA_PLANE_ACTIONS = [
  'logs:GetLogEvents',
  'logs:FilterLogEvents',
  'logs:GetLogRecord',
  'logs:GetQueryResults',
  'logs:StartQuery',
  'logs:StartLiveTail',
  'logs:GetLogGroupFields',
  'logs:Unmask',
];

/**
 * cdkd（CDK Direct）用の IAM ポリシー定義（Issue #150）。
 *
 * cdkd は CloudFormation を経由せず AWS の API を直接叩くため、
 * CDK bootstrap が作る `cdk-hnb659fds-*` ロールは使えない。デプロイする
 * identity 自身が、作るリソース全部の操作権限を持っている必要がある。
 *
 * 公式は admin 相当を要求しているが、いきなり AdministratorAccess を貼ると
 * 「main への push から到達できる管理者権限」がひとつ増える。まずは
 * このアプリが実際に使っているサービスだけに絞り、不足は
 * `cdkd deploy --dry-run` と実デプロイで洗い出して足していく方針にする。
 *
 * 絞り方の濃淡は「その権限で利用者のデータが読めるか」で決めている:
 *
 * - 読めないもの（AppSync / Lambda / CloudWatch / SNS / EventBridge / ECR）
 *   はサービス単位のワイルドカードで許可する。列挙しても事故が減らないわりに、
 *   足りない API のたびにデプロイが止まる
 * - 読めるもの（DynamoDB / Cognito / S3 のオブジェクト / CloudWatch Logs の中身）
 *   はコントロールプレーンの API だけを列挙する。記録の中身も利用者の sub も
 *   デプロイには要らない
 */

/**
 * cdkd のデプロイロールに渡す権限。
 *
 * @param account デプロイ先のアカウント ID
 */
export function cdkdDeployStatements(account: string): iam.PolicyStatement[] {
  return [
    // 利用者のデータに触れないサービス群。ここはサービス単位で許可する。
    //
    // applicationsignals は SLO の作成に要る（Issue #86）。Cloud Control API
    // 経由で作られるが、その先で applicationsignals:CreateServiceLevelObjective
    // が呼ばれるため、UseCloudControlApi だけでは足りない（PR #161 のレビュー指摘）。
    //
    // このサービスが扱うのはサービスマップ・ゴールデンメトリクス・SLO で、
    // 記録や画像には届かない。スパンの中身は CloudWatch Logs（aws/spans）側に
    // あり、そちらは下の DenyLogDataPlane で引き続き読めない
    new iam.PolicyStatement({
      sid: 'ManageStatelessServices',
      actions: [
        'appsync:*',
        'lambda:*',
        'cloudwatch:*',
        'sns:*',
        'events:*',
        'ecr:*',
        'applicationsignals:*',
      ],
      resources: ['*'],
    }),

    // CloudWatch Logs はログ本文に利用者の sub が入りうるので、
    // ロググループとメトリクスフィルターの管理に必要なものだけを列挙する
    new iam.PolicyStatement({
      sid: 'ManageLogGroups',
      actions: [
        'logs:CreateLogGroup',
        'logs:DeleteLogGroup',
        'logs:DescribeLogGroups',
        'logs:PutRetentionPolicy',
        'logs:DeleteRetentionPolicy',
        'logs:PutMetricFilter',
        'logs:DeleteMetricFilter',
        'logs:DescribeMetricFilters',
        'logs:TagLogGroup',
        'logs:UntagLogGroup',
        'logs:TagResource',
        'logs:UntagResource',
        'logs:ListTagsForResource',
      ],
      resources: ['*'],
    }),

    // 上の列挙から漏れたデータプレーンの API が将来増えても届かないように
    new iam.PolicyStatement({
      sid: 'DenyLogDataPlane',
      effect: iam.Effect.DENY,
      actions: LOGS_DATA_PLANE_ACTIONS,
      resources: ['*'],
    }),

    // DynamoDB は記録そのものが入っているため、テーブルの作成・変更に必要な
    // コントロールプレーンだけ。GetItem / Query / Scan は入れない
    new iam.PolicyStatement({
      sid: 'ManageDynamoDbTables',
      actions: [
        'dynamodb:CreateTable',
        'dynamodb:DeleteTable',
        'dynamodb:DescribeTable',
        'dynamodb:UpdateTable',
        'dynamodb:DescribeTimeToLive',
        'dynamodb:UpdateTimeToLive',
        'dynamodb:DescribeContinuousBackups',
        'dynamodb:UpdateContinuousBackups',
        'dynamodb:DescribeStream',
        'dynamodb:ListStreams',
        'dynamodb:ListTagsOfResource',
        'dynamodb:TagResource',
        'dynamodb:UntagResource',
      ],
      resources: ['*'],
    }),

    // Cognito も同様。ListUsers / AdminGetUser のような利用者を引ける API は
    // 入れない（UserPool と Client の作り替えには要らない）
    new iam.PolicyStatement({
      sid: 'ManageCognitoUserPools',
      actions: [
        'cognito-idp:CreateUserPool',
        'cognito-idp:DeleteUserPool',
        'cognito-idp:DescribeUserPool',
        'cognito-idp:UpdateUserPool',
        'cognito-idp:GetUserPoolMfaConfig',
        'cognito-idp:SetUserPoolMfaConfig',
        'cognito-idp:AddCustomAttributes',
        'cognito-idp:CreateUserPoolClient',
        'cognito-idp:DeleteUserPoolClient',
        'cognito-idp:DescribeUserPoolClient',
        'cognito-idp:UpdateUserPoolClient',
        'cognito-idp:ListUserPoolClients',
        'cognito-idp:ListTagsForResource',
        'cognito-idp:TagResource',
        'cognito-idp:UntagResource',
      ],
      resources: ['*'],
    }),

    // cdkd の state とアセット。state バケットは全コマンドが読み書きする
    new iam.PolicyStatement({
      sid: 'ManageCdkdStateAndAssets',
      actions: ['s3:*'],
      resources: [
        `arn:aws:s3:::cdkd-state-${account}`,
        `arn:aws:s3:::cdkd-state-${account}/*`,
        `arn:aws:s3:::cdkd-assets-${account}-*`,
        `arn:aws:s3:::cdkd-assets-${account}-*/*`,
      ],
    }),

    // 画像バケットはバケット自体の設定だけ触れればよい。中身（利用者が
    // 上げたレシート画像）を読み書きする権限は渡さない
    new iam.PolicyStatement({
      sid: 'ManageImageBucketConfiguration',
      actions: [
        's3:CreateBucket',
        's3:DeleteBucket',
        's3:ListBucket',
        's3:GetBucketLocation',
        's3:GetBucketPolicy',
        's3:PutBucketPolicy',
        's3:DeleteBucketPolicy',
        's3:GetBucketCORS',
        's3:PutBucketCORS',
        's3:GetBucketPublicAccessBlock',
        's3:PutBucketPublicAccessBlock',
        's3:GetEncryptionConfiguration',
        's3:PutEncryptionConfiguration',
        's3:GetLifecycleConfiguration',
        's3:PutLifecycleConfiguration',
        's3:GetBucketVersioning',
        's3:PutBucketVersioning',
        's3:GetBucketNotification',
        's3:PutBucketNotification',
        's3:GetBucketOwnershipControls',
        's3:PutBucketOwnershipControls',
        's3:GetBucketTagging',
        's3:PutBucketTagging',
      ],
      // 環境接頭辞が付くため dev / staging / prod をまとめて拾う
      resources: ['arn:aws:s3:::*-sakekasu-images'],
    }),

    // Lambda や AppSync の実行ロールを作る。スタック名が接頭辞に付くので
    // sakekasu-* に閉じられる（自動生成名は <スタック名>-<論理ID><ハッシュ>）。
    //
    // 権限を書き換える系の API は、対象ロールに Permissions Boundary が
    // 付いていることを条件にする。境界の無いロールは作れず、境界の付いた
    // ロールに管理者相当を書き込んでも実効権限は境界で頭打ちになるため、
    // 「ロールに書き込む → その権限で動かす」という昇格の連鎖が切れる。
    //
    // 条件を付けられるのは iam:PermissionsBoundary に対応したアクションだけ。
    // TagRole などに付けると、キーが渡らないため常に不一致となり
    // 恒久的な AccessDenied になる。対応しているものだけをここに集める
    new iam.PolicyStatement({
      sid: 'ManageApplicationRolesWithinBoundary',
      actions: [
        'iam:CreateRole',
        'iam:DeleteRole',
        'iam:PutRolePolicy',
        'iam:DeleteRolePolicy',
        'iam:AttachRolePolicy',
        'iam:DetachRolePolicy',
        'iam:PutRolePermissionsBoundary',
      ],
      resources: [`arn:aws:iam::${account}:role/sakekasu-*`],
      conditions: {
        ArnEquals: { 'iam:PermissionsBoundary': roleBoundaryArn(account) },
      },
    }),

    // 読み取りと、権限に影響しない属性の変更。iam:PermissionsBoundary が
    // 渡らないアクションなので条件は付けられない。
    //
    // iam:UpdateAssumeRolePolicy はここに入れてはいけない。信頼ポリシーを
    // まるごと書き換える API で、「誰がそのロールになれるか」を変えられる。
    // 外部のアカウントを信頼先に足せば、そのロールの権限をそのまま使える。
    // 境界は iam と sts しか拒否しないので、たとえば OCR 関数のロールを
    // 乗っ取れば DynamoDB の記録や S3 の画像に届いてしまう。
    //
    // cdkd がこれを必要とするのは、CDK 側で assumedBy を変えたときだけ。
    // 起きたら AccessDenied で止まるので、そのときは人間が手で直す
    // （PR #152 のレビュー指摘）
    new iam.PolicyStatement({
      sid: 'ReadAndTagApplicationRoles',
      actions: [
        'iam:GetRole',
        'iam:UpdateRole',
        'iam:UpdateRoleDescription',
        'iam:GetRolePolicy',
        'iam:ListRolePolicies',
        'iam:ListAttachedRolePolicies',
        'iam:ListRoleTags',
        'iam:TagRole',
        'iam:UntagRole',
      ],
      resources: [`arn:aws:iam::${account}:role/sakekasu-*`],
    }),

    // iam:PassedToService は PassRole 専用の条件キーで、他のアクションには
    // 効かない。同じステートメントに混ぜると、そちらが常に拒否されるため分ける
    new iam.PolicyStatement({
      sid: 'PassApplicationRolesToKnownServices',
      actions: ['iam:PassRole'],
      resources: [`arn:aws:iam::${account}:role/sakekasu-*`],
      conditions: {
        StringEquals: { 'iam:PassedToService': PASS_ROLE_TARGET_SERVICES },
      },
    }),

    // AWS 管理ポリシーを AttachRolePolicy で貼るとき、cdkd が中身を読む
    new iam.PolicyStatement({
      sid: 'ReadAwsManagedPolicies',
      actions: ['iam:GetPolicy', 'iam:GetPolicyVersion', 'iam:ListPolicyVersions'],
      resources: ['arn:aws:iam::aws:policy/*'],
    }),

    // AppSync や EventBridge が初回に要求することがある
    new iam.PolicyStatement({
      sid: 'CreateServiceLinkedRoles',
      actions: ['iam:CreateServiceLinkedRole'],
      resources: ['*'],
    }),

    // 自分と、自分を呼ぶ側のロールは触らせない。sakekasu-* に含まれてしまう
    // ため、明示的に Deny で抜く。これが無いと、main に入った infra の変更から
    // このロール自身の権限を書き換えられる
    new iam.PolicyStatement({
      sid: 'DenyTamperingWithOidcRoles',
      effect: iam.Effect.DENY,
      actions: ['iam:*'],
      resources: [
        `arn:aws:iam::${account}:role/sakekasu-cdkd-deploy`,
        `arn:aws:iam::${account}:role/sakekasu-github-actions-deploy`,
        `arn:aws:iam::${account}:role/sakekasu-github-actions-diff`,
        `arn:aws:iam::${account}:oidc-provider/token.actions.githubusercontent.com`,
      ],
    }),

    // 境界そのものを外されると上の条件が意味を失う。境界の削除と、
    // 境界ポリシーの中身の書き換えを塞ぐ（AWS の推奨どおり、境界の管理は
    // デプロイ用の identity から切り離す）
    new iam.PolicyStatement({
      sid: 'DenyEscapingTheRoleBoundary',
      effect: iam.Effect.DENY,
      actions: [
        'iam:DeleteRolePermissionsBoundary',
        'iam:DeleteUserPermissionsBoundary',
      ],
      resources: ['*'],
    }),
    new iam.PolicyStatement({
      sid: 'DenyRewritingTheRoleBoundary',
      effect: iam.Effect.DENY,
      actions: [
        'iam:CreatePolicyVersion',
        'iam:DeletePolicyVersion',
        'iam:SetDefaultPolicyVersion',
        'iam:DeletePolicy',
      ],
      resources: [roleBoundaryArn(account)],
    }),

    // cdkd が対応表に持たない型（Cognito UserPoolClient / Logs MetricFilter /
    // AppSync FunctionConfiguration）は Cloud Control API で作られる。
    // Cloud Control のアクションは cloudformation 名前空間にある
    new iam.PolicyStatement({
      sid: 'UseCloudControlApi',
      actions: [
        'cloudformation:CreateResource',
        'cloudformation:GetResource',
        'cloudformation:UpdateResource',
        'cloudformation:DeleteResource',
        'cloudformation:ListResources',
        'cloudformation:GetResourceRequestStatus',
        'cloudformation:CancelResourceRequest',
      ],
      resources: ['*'],
    }),

    // CloudFormation 側は3つの用途で要る:
    //  1. 移行時の `cdkd import --migrate-from-cloudformation`
    //     （Retain を注入する UpdateStack と DeleteStack）
    //  2. 移行途中の Fn::ImportValue のフォールバック（ListExports）
    //  3. CFn へ戻すときの `cdkd export`（IMPORT チェンジセット）
    new iam.PolicyStatement({
      sid: 'ManageCloudFormationDuringMigration',
      actions: [
        'cloudformation:ListExports',
        'cloudformation:ListStacks',
        'cloudformation:DescribeStacks',
        'cloudformation:DescribeStackResource',
        'cloudformation:DescribeStackResources',
        'cloudformation:DescribeStackEvents',
        'cloudformation:GetTemplate',
        'cloudformation:GetTemplateSummary',
        'cloudformation:UpdateStack',
        'cloudformation:DeleteStack',
        'cloudformation:CreateChangeSet',
        'cloudformation:DescribeChangeSet',
        'cloudformation:ExecuteChangeSet',
        'cloudformation:DeleteChangeSet',
        'cloudformation:ListChangeSets',
      ],
      resources: ['*'],
    }),
  ];
}

/**
 * cdkd の差分表示（`cdkd diff`）に必要な読み取り権限。
 *
 * PR から流れるロールに付くので、書き込みは一切入れない。読み取りでも
 * 「利用者のデータが取れるもの」は外す:
 *
 * - `logs:GetLogEvents` / `FilterLogEvents`（ログに Cognito sub が入りうる）
 * - `dynamodb:GetItem` / `Query` / `Scan`
 * - `cognito-idp:ListUsers` / `AdminGetUser`
 * - `s3:GetObject`（画像バケット。state バケットの読み取りだけ別で許可する）
 *
 * ReadOnlyAccess を貼ると上が全部入ってしまうため、使わない。
 */
export function cdkdDiffStatements(account: string): iam.PolicyStatement[] {
  return [
    new iam.PolicyStatement({
      sid: 'ReadStatelessServices',
      actions: [
        'appsync:Get*',
        'appsync:List*',
        'lambda:Get*',
        'lambda:List*',
        'logs:Describe*',
        'logs:ListTagsForResource',
        'cloudwatch:Describe*',
        'cloudwatch:List*',
        'sns:Get*',
        'sns:List*',
        'events:Describe*',
        'events:List*',
        'ecr:Describe*',
        'ecr:List*',
        'ecr:GetRepositoryPolicy',
      ],
      resources: ['*'],
    }),

    new iam.PolicyStatement({
      sid: 'ReadStatefulResourceMetadata',
      actions: [
        'dynamodb:DescribeTable',
        'dynamodb:DescribeTimeToLive',
        'dynamodb:DescribeContinuousBackups',
        'dynamodb:ListTagsOfResource',
        'cognito-idp:DescribeUserPool',
        'cognito-idp:DescribeUserPoolClient',
        'cognito-idp:ListUserPoolClients',
        'cognito-idp:GetUserPoolMfaConfig',
        'cognito-idp:ListTagsForResource',
      ],
      resources: ['*'],
    }),

    new iam.PolicyStatement({
      sid: 'ReadImageBucketConfiguration',
      actions: [
        's3:ListBucket',
        's3:GetBucketLocation',
        's3:GetBucketPolicy',
        's3:GetBucketCORS',
        's3:GetBucketPublicAccessBlock',
        's3:GetEncryptionConfiguration',
        's3:GetLifecycleConfiguration',
        's3:GetBucketVersioning',
        's3:GetBucketNotification',
        's3:GetBucketOwnershipControls',
        's3:GetBucketTagging',
      ],
      resources: ['arn:aws:s3:::*-sakekasu-images'],
    }),

    new iam.PolicyStatement({
      sid: 'ReadCdkdState',
      actions: ['s3:GetObject', 's3:ListBucket', 's3:GetBucketLocation'],
      resources: [
        `arn:aws:s3:::cdkd-state-${account}`,
        `arn:aws:s3:::cdkd-state-${account}/*`,
      ],
    }),

    new iam.PolicyStatement({
      sid: 'ReadApplicationRoles',
      actions: [
        'iam:GetRole',
        'iam:GetRolePolicy',
        'iam:ListRolePolicies',
        'iam:ListAttachedRolePolicies',
        'iam:ListRoleTags',
      ],
      resources: [`arn:aws:iam::${account}:role/sakekasu-*`],
    }),

    // 未対応型は Cloud Control 経由で読む。移行途中は Fn::ImportValue が
    // CloudFormation の Exports にフォールバックするため、そちらも読めるように
    new iam.PolicyStatement({
      sid: 'ReadCloudControlAndExports',
      actions: [
        'cloudformation:GetResource',
        'cloudformation:ListResources',
        'cloudformation:GetResourceRequestStatus',
        'cloudformation:ListExports',
        'cloudformation:DescribeStacks',
        'cloudformation:GetTemplate',
      ],
      resources: ['*'],
    }),
  ];
}
