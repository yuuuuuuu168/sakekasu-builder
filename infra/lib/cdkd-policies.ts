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
 * @param siteZone フロントの配信に使うサブドメインのゾーン（例: sake.sakekasu-builder.com）。
 *   DNS レコードを書き換えられる範囲をこのゾーンの名前に絞る
 */
export function cdkdDeployStatements(account: string, siteZone: string): iam.PolicyStatement[] {
  return [
    // 利用者のデータに触れないサービス群。ここはサービス単位で許可する
    new iam.PolicyStatement({
      sid: 'ManageStatelessServices',
      actions: [
        'appsync:*',
        'lambda:*',
        'cloudwatch:*',
        'sns:*',
        'events:*',
        'ecr:*',
      ],
      resources: ['*'],
    }),

    // Application Signals は SLO の操作だけに絞る（Issue #86）。
    //
    // SLO は Cloud Control API 経由で作られるが、その先で
    // applicationsignals:CreateServiceLevelObjective が呼ばれるため、
    // UseCloudControlApi の cloudformation:CreateResource だけでは足りない。
    //
    // **`applicationsignals:*` にはしない。** サービス検出の有効化
    // （StartDiscovery）が入ってしまうため。これはアカウントに1つの設定で、
    // 一度スタックに載せて失敗したときにロールバックがそれを消しにいき、
    // ソムリエの可観測性を道連れにしかけた（monitoring-stack.ts のコメント）。
    // スタックから外して守っている設定を、IAM の側から素通りで触れる形にしない
    // （PR #161 のレビュー指摘）。
    //
    // 足りない操作が出たらデプロイが AccessDenied で落ちる。落ちれば分かるので、
    // 分からないまま広い権限を渡すよりよい
    new iam.PolicyStatement({
      sid: 'ManageServiceLevelObjectives',
      actions: [
        'applicationsignals:CreateServiceLevelObjective',
        'applicationsignals:UpdateServiceLevelObjective',
        'applicationsignals:DeleteServiceLevelObjective',
        'applicationsignals:GetServiceLevelObjective',
        'applicationsignals:ListServiceLevelObjectives',
        'applicationsignals:TagResource',
        'applicationsignals:UntagResource',
        'applicationsignals:ListTagsForResource',
      ],
      resources: ['*'],
    }),

    // 上の列挙が将来ワイルドカードに戻されても、アカウント単位の設定には
    // 届かないようにする。DenyLogDataPlane と同じ考え方
    new iam.PolicyStatement({
      sid: 'DenyApplicationSignalsAccountSettings',
      effect: iam.Effect.DENY,
      actions: ['applicationsignals:StartDiscovery'],
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

    // Cognito は読み取りだけ。ListUsers / AdminGetUser のような利用者を引ける API は
    // 入れない。
    //
    // 作成・更新・削除は外した。このアプリのスタックが持っていた Cognito のリソースは
    // 旧ユーザープール（sakekasu-dev-auth）だけで、共通ログインへ移ってアプリから
    // 外したため。旧プールの片付け（cdkd state destroy）は人が自分の権限で打つ
    // （docs/shared-login.md の「旧ユーザープールを外す」）。
    //
    // 読み取りを残すのは、api の AppSync が共通ログインのプールを認可に使っているため。
    // AppSync の作成・更新でプールの確認が呼び出し元の権限で走るかどうかを確かめて
    // いないので、ここを空にして api のデプロイを落とす賭けはしない
    new iam.PolicyStatement({
      sid: 'ReadCognitoUserPools',
      actions: [
        'cognito-idp:DescribeUserPool',
        'cognito-idp:DescribeUserPoolClient',
        'cognito-idp:ListUserPoolClients',
        'cognito-idp:GetUserPoolMfaConfig',
        'cognito-idp:ListTagsForResource',
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

    // 画像バケットと配信バケットは、バケット自体の設定だけ触れればよい。
    // 中身（利用者が上げた画像、配信物）を読み書きする権限は渡さない。
    // 配信物を置くのは別のロール（sakekasu-github-actions-site）
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
      resources: ['arn:aws:s3:::*-sakekasu-images', `arn:aws:s3:::*-sakekasu-site-${account}`],
    }),

    ...siteDeliveryStatements(siteZone),

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
        `arn:aws:iam::${account}:role/sakekasu-github-actions-site`,
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

    // cdkd が対応表に持たない型（Logs MetricFilter / AppSync FunctionConfiguration。
    // 旧ユーザープールを外す前は Cognito UserPoolClient も）は Cloud Control API で作られる。
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

    // cdkd は型ごとの「作成時にしか指定できないプロパティ」を
    // cloudformation:DescribeType で引き、差し替えが要る変更かどうかを判定する。
    // 読めないと同梱のスキーマ写しに落ちる。写しは AWS の現物より古くなりうるので、
    // AWS 側で更新可能になったプロパティを差し替えと誤判定する余地が残る。
    // DynamoDB テーブルのような作り直しの効かないものに当たると取り返しがつかない。
    //
    // 対象は公開されている型のスキーマだけ（リソースの中身ではない）なので、
    // リソースは type/resource/* に絞って渡す
    new iam.PolicyStatement({
      sid: 'ReadResourceTypeSchemas',
      actions: ['cloudformation:DescribeType'],
      resources: ['arn:aws:cloudformation:*::type/resource/*'],
    }),
  ];
}

/**
 * フロントの配信（site-dns-stack.ts / site-stack.ts）を作るための権限。
 *
 * どれも利用者のデータを持たないので、読めること自体は問題にならない。
 * 気をつけるのは、同じアカウントに他のアプリ（kakeibo・learning・reinvent）の
 * ゾーンとディストリビューションも同居していること。
 *
 * - DNS レコードの書き換えは、`siteZone` とその配下の名前だけに絞る
 *   （route53:ChangeResourceRecordSetsNormalizedRecordNames）。ゾーン ID では絞れない。
 *   ゾーンを作るのはこのロール自身で、作るまで ID が決まらないため。
 *   名前で絞れば、他のアプリのサブドメインを乗っ取る向きの書き換えはできない
 * - ゾーンの削除（DeleteHostedZone）は渡さない。ゾーンは RETAIN で、cdkd が消しに
 *   いくことは無い。渡すと他のアプリのゾーンを消せてしまう
 * - CloudFront はリソースを絞れない（ディストリビューションの ID は作るまで決まらない）。
 *   他のアプリのディストリビューションの設定も書き換えられる。上の lambda:* と同じ
 *   性質の穴で、main への push からしか使えないことが歯止めになる
 * - キャッシュの無効化（CreateInvalidation）は渡さない。配信物の更新では打たない
 *   設計にしてある（site-stack.ts の冒頭）
 */
function siteDeliveryStatements(siteZone: string): iam.PolicyStatement[] {
  return [
    new iam.PolicyStatement({
      sid: 'ManageSiteHostedZone',
      actions: [
        'route53:CreateHostedZone',
        'route53:GetHostedZone',
        'route53:UpdateHostedZoneComment',
        'route53:ListResourceRecordSets',
        'route53:ChangeTagsForResource',
        'route53:ListTagsForResource',
        'route53:GetChange',
      ],
      resources: ['*'],
    }),
    new iam.PolicyStatement({
      sid: 'ChangeSiteRecordsOnly',
      actions: ['route53:ChangeResourceRecordSets'],
      resources: ['arn:aws:route53:::hostedzone/*'],
      conditions: {
        // 正規化された名前は小文字で、末尾のドットが無い。証明書の検証レコード
        // （_xxxx.sake.sakekasu-builder.com）は2つ目の形で拾う
        'ForAllValues:StringLike': {
          'route53:ChangeResourceRecordSetsNormalizedRecordNames': [siteZone, `*.${siteZone}`],
        },
      },
    }),
    new iam.PolicyStatement({
      sid: 'ManageSiteCertificate',
      actions: [
        'acm:RequestCertificate',
        'acm:DescribeCertificate',
        'acm:DeleteCertificate',
        'acm:ListCertificates',
        'acm:AddTagsToCertificate',
        'acm:RemoveTagsFromCertificate',
        'acm:ListTagsForCertificate',
      ],
      resources: ['*'],
    }),
    // ResponseHeadersPolicy は cdkd の対応表に無く Cloud Control API で作られる
    // （docs/amplify-exit.md）。その先で cloudfront の API が呼ばれるので、ここで許可する
    new iam.PolicyStatement({
      sid: 'ManageSiteDistribution',
      actions: [
        'cloudfront:CreateDistribution',
        'cloudfront:CreateDistributionWithTags',
        'cloudfront:GetDistribution',
        'cloudfront:GetDistributionConfig',
        'cloudfront:UpdateDistribution',
        'cloudfront:DeleteDistribution',
        'cloudfront:ListDistributions',
        'cloudfront:CreateOriginAccessControl',
        'cloudfront:GetOriginAccessControl',
        'cloudfront:GetOriginAccessControlConfig',
        'cloudfront:UpdateOriginAccessControl',
        'cloudfront:DeleteOriginAccessControl',
        'cloudfront:ListOriginAccessControls',
        'cloudfront:CreateResponseHeadersPolicy',
        'cloudfront:GetResponseHeadersPolicy',
        'cloudfront:GetResponseHeadersPolicyConfig',
        'cloudfront:UpdateResponseHeadersPolicy',
        'cloudfront:DeleteResponseHeadersPolicy',
        'cloudfront:ListResponseHeadersPolicies',
        'cloudfront:GetCachePolicy',
        'cloudfront:ListCachePolicies',
        'cloudfront:TagResource',
        'cloudfront:UntagResource',
        'cloudfront:ListTagsForResource',
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
        // SLO は Cloud Control 経由で読まれるので、その先の権限が要る。
        // 無いと SLO をデプロイした後の cdkd diff が AccessDenied で落ちる。
        // Cognito UserPoolClient に cognito-idp:DescribeUserPoolClient を
        // 足してあるのと同じ形（PR #161 のレビュー指摘）
        'applicationsignals:GetServiceLevelObjective',
        'applicationsignals:ListServiceLevelObjectives',
        'applicationsignals:ListTagsForResource',
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
      resources: ['arn:aws:s3:::*-sakekasu-images', `arn:aws:s3:::*-sakekasu-site-${account}`],
    }),

    // フロントの配信（site-dns-stack.ts / site-stack.ts）。どれも利用者のデータを持たない
    new iam.PolicyStatement({
      sid: 'ReadSiteDelivery',
      actions: [
        'route53:GetHostedZone',
        'route53:ListResourceRecordSets',
        'route53:ListTagsForResource',
        'acm:DescribeCertificate',
        'acm:ListTagsForCertificate',
        'cloudfront:GetDistribution',
        'cloudfront:GetDistributionConfig',
        'cloudfront:GetOriginAccessControl',
        'cloudfront:GetOriginAccessControlConfig',
        'cloudfront:GetResponseHeadersPolicy',
        'cloudfront:GetResponseHeadersPolicyConfig',
        'cloudfront:GetCachePolicy',
        'cloudfront:ListDistributions',
        'cloudfront:ListOriginAccessControls',
        'cloudfront:ListResponseHeadersPolicies',
        'cloudfront:ListCachePolicies',
        'cloudfront:ListTagsForResource',
      ],
      resources: ['*'],
    }),

    new iam.PolicyStatement({
      sid: 'ReadCdkdState',
      actions: ['s3:GetObject', 's3:ListBucket', 's3:GetBucketLocation'],
      resources: [
        `arn:aws:s3:::cdkd-state-${account}`,
        `arn:aws:s3:::cdkd-state-${account}/*`,
      ],
    }),

    // cdkd は diff でもリージョンのアセット保管庫が自分のものかを確かめる。
    // ExpectedBucketOwner 付きの HeadBucket で問い合わせ、権限が無いと 403 が
    // 返る。cdkd は 403 を「他アカウントのバケット」と解釈して止まるため、
    // 権限不足が「バケットの乗っ取り」に見えるエラーになる（PR #230 の CI で判明）。
    //
    //   CdkdError: Asset bucket 'cdkd-assets-...' exists but is not owned by
    //   account ... (or access is denied). Refusing to use it.
    //
    // HeadBucket に要るのは s3:ListBucket だけ。中身は読まないので
    // GetObject は入れない。ECR 側の DescribeRepositories は
    // ReadStatelessServices の ecr:Describe* で足りている
    new iam.PolicyStatement({
      sid: 'ProbeCdkdAssetStorage',
      actions: ['s3:ListBucket'],
      resources: [`arn:aws:s3:::cdkd-assets-${account}-*`],
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

    // cdkd は型ごとの「作成時にしか指定できないプロパティ」を
    // cloudformation:DescribeType で引き、差し替えが要る変更かどうかを判定する。
    // 読めないと同梱のスキーマ写しに落ちる。写しは AWS の現物より古くなりうるので、
    // AWS 側で更新可能になったプロパティを差し替えと誤判定する余地が残る。
    // DynamoDB テーブルのような作り直しの効かないものに当たると取り返しがつかない。
    //
    // 対象は公開されている型のスキーマだけ（リソースの中身ではない）なので、
    // リソースは type/resource/* に絞って渡す
    new iam.PolicyStatement({
      sid: 'ReadResourceTypeSchemas',
      actions: ['cloudformation:DescribeType'],
      resources: ['arn:aws:cloudformation:*::type/resource/*'],
    }),
  ];
}
