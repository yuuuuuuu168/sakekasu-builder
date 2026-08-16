import * as iam from 'aws-cdk-lib/aws-iam';

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
    // 利用者のデータに触れないサービス群。ここはサービス単位で許可する
    new iam.PolicyStatement({
      sid: 'ManageStatelessServices',
      actions: [
        'appsync:*',
        'lambda:*',
        'logs:*',
        'cloudwatch:*',
        'sns:*',
        'events:*',
        'ecr:*',
      ],
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
    // sakekasu-* に閉じられる（自動生成名は <スタック名>-<論理ID><ハッシュ>）
    new iam.PolicyStatement({
      sid: 'ManageApplicationRoles',
      actions: [
        'iam:CreateRole',
        'iam:DeleteRole',
        'iam:GetRole',
        'iam:UpdateRole',
        'iam:UpdateRoleDescription',
        'iam:UpdateAssumeRolePolicy',
        'iam:PutRolePolicy',
        'iam:DeleteRolePolicy',
        'iam:GetRolePolicy',
        'iam:ListRolePolicies',
        'iam:AttachRolePolicy',
        'iam:DetachRolePolicy',
        'iam:ListAttachedRolePolicies',
        'iam:ListRoleTags',
        'iam:TagRole',
        'iam:UntagRole',
        'iam:PassRole',
      ],
      resources: [`arn:aws:iam::${account}:role/sakekasu-*`],
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
