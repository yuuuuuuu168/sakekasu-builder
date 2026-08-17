import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as applicationsignals from 'aws-cdk-lib/aws-applicationsignals';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as path from 'node:path';
import * as url from 'node:url';
import type { Construct } from 'constructs';
import { LAMBDA_LOG_RETENTION } from './log-retention.js';
import { applyRoleBoundary } from './role-boundary.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));

/**
 * SLO の目標達成率（Issue #86）。
 *
 * SLO の定義とアラームのしきい値で同じ値を使う。別々に書くと、片方だけ
 * 動かしたときに「SLO は 95% を目標にしているのにアラームは 90% で鳴る」
 * のような食い違いが黙って生まれる。
 *
 * 90% にしている理由は `addOcrServiceLevelObjectives()` の説明を参照。
 */
const SLO_ATTAINMENT_GOAL = 90;

/**
 * SLO の評価から外す期間（Issue #86）。
 *
 * 2026-08-17 に SLO を入れた時点で、可用性の達成率は 84.51%（71 リクエスト中
 * 11 回が失敗）だった。中身を追ったところ、**11 件すべてが解消済みの問題**で、
 * 現行のコードに起因する失敗は1件も無かった。
 *
 * | 日時（UTC） | 件数 | 原因 |
 * |---|---|---|
 * | 08-03 11:09 / 08-08 14:28 ×5 / 08-09 07:57 ×3 | 9 | Issue #115（Bedrock の 5MB 上限は base64 後の値） |
 * | 08-10 03:52 / 04:50 | 2 | `event.arguments` が無い直接 invoke。計装の動作確認中の手動実行 |
 *
 * #115 は PR #117（2026-08-10 02:04Z）で修正済みで、それ以降この失敗は
 * 一度も起きていない。つまり達成率が低いのは30日窓に履歴が残っているだけで、
 * 放っておいても 09-09 ごろには自然に戻る。
 *
 * ただしその間ずっとアラームが鳴りっぱなしになる。直すものが無いのに赤が
 * 続く状態は、通知を読まなくなるという形で監視そのものを損なう。だから
 * 期間ごと評価から外す。
 *
 * 両方の SLO に同じ窓を掛けている。レイテンシー SLO が失敗した呼び出しを
 * どう数えるかは実機で確かめていないので、片方だけ外して非対称にするより、
 * 「既知の問題があった期間」として揃えて外すほうが説明が一貫する。
 *
 * **この窓は 2026-09 以降は消してよい。** 窓から履歴が抜ければ役目は終わる。
 */
const SLO_EXCLUSION_WINDOW = {
  reason:
    'Issue #115（PR #117 で修正済み）と、計装の動作確認中の手動 invoke。この期間の失敗11件はすべて調査済みで、現行コードに起因するものは無い',
  // 最初の失敗が 08-03 11:09Z、最後が 08-10 04:50Z。両端に余裕を持たせて
  // 08-03 00:00Z から 8 日ぶん（08-11 00:00Z まで）を外す。
  //
  // **#115 の修正（08-10 02:04Z）より後の約22時間もこの窓に入る。** そこに
  // 含まれる失敗は上表の2件（手動 invoke）だけで、それも現行コードの問題では
  // ないため、境界を修正時刻ぴったりに切らずまとめて外している。
  // この22時間に他の失敗が無いことは実測で確認済み（当日の Lambda エラーは
  // 2件のみで、どちらも上表の手動 invoke）。08-11 以降のデータは残る
  startTime: '2026-08-03T00:00:00Z',
  window: { duration: 8, durationUnit: 'DAY' },
};

export interface MonitoringStackProps extends cdk.StackProps {
  /** 環境名（dev, staging, prod） */
  envName: string;
  /** 監視対象の AppSync API */
  graphqlApi: appsync.GraphqlApi;
  /** 監視対象の DynamoDB テーブル */
  tables: dynamodb.Table[];
  /** 監視対象の Lambda 関数 */
  functions: NodejsFunction[];
  /** AI（OCR）Lambda。AI 用のまとまりとして別に扱う */
  ocrFunction: NodejsFunction;
  /** 画像削除失敗のメトリクスフィルター（アラームはこちらで作る） */
  imageDeleteFailMetricFilter: logs.MetricFilter;
  /** 新規登録の Slack 通知失敗のメトリクスフィルター（アラームはこちらで作る） */
  signupNotifyFailMetricFilter: logs.MetricFilter;
  /** ソムリエ Runtime の ARN */
  sommelierRuntimeArn: string;
  /** フロントの公開 URL（外形監視の対象） */
  siteUrl: string;
  /** カナリアが使う Cognito */
  userPoolId: string;
  /** カナリア専用のクライアント ID（ブラウザ向けとは分ける） */
  canaryUserPoolClientId: string;
}

/**
 * 監視とアラート通知をまとめたスタック。
 *
 * 通知先の Slack Webhook URL と、カナリアが使う監視ユーザーの認証情報は
 * リポジトリに置けないため、デプロイ前に手動で登録した SSM / Secrets Manager
 * を名前で参照する（README の手順を参照）。
 */
export class MonitoringStack extends cdk.Stack {
  public readonly alertTopic: sns.Topic;

  /** 外形監視・カナリアが書き込むカスタムメトリクスの名前空間 */
  private readonly metricNamespace: string;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    // このスタックが作るロールはすべて Permissions Boundary の内側に置く
    // （Issue #150）。cdkd のデプロイロールは境界の付いたロールしか
    // 作り替えられない条件になっているため、外すとデプロイが止まる。
    // 詳細は lib/role-boundary.ts
    applyRoleBoundary(this);

    const prefix = `${props.envName}-sakekasu`;
    this.metricNamespace = `${prefix}-monitoring`;

    const webhookParameterName = `/${prefix}/monitoring/slack-webhook-url`;
    const canaryCredentialsSecretName = `${prefix}/monitoring/canary-user`;

    // --- Application Signals（Issue #86）---
    //
    // サービス検出（AWS::ApplicationSignals::Discovery）と Transaction Search
    // （AWS::XRay::TransactionSearchConfig）は、ここでは作らない。
    //
    // どちらもアカウントに1つの設定で、このアカウントでは 2026-08-04 に
    // ソムリエの GenAI Observability を入れたときから有効になっている。
    // 知らずにスタックへ足したところ、AlreadyExists で作成に失敗し、
    // そのロールバックが「既に有効だった設定」を消しにいった。
    //
    // 片方のスタックの巻き戻しが他機能の可観測性を道連れにする形なので、
    // スタックの寿命とは切り離してアカウント側の設定として扱う。
    // 新しいアカウントに展開するときの有効化手順は docs/application-signals.md を参照。
    //
    // 計装そのもの（ADOT レイヤー・実行ロールの権限）は API スタック側にある。
    //
    // SLO はここで作る。API スタックに置くと、エラーバジェットのアラームを
    // 足すときに通知先の SNS を参照して循環参照になる。
    this.addOcrServiceLevelObjectives(props.envName);

    // --- 通知経路 ---

    this.alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: `${prefix}-alerts`,
      displayName: '酒カス 監視アラート',
    });

    const slackNotifier = new NodejsFunction(this, 'SlackNotifierFunction', {
      functionName: `${prefix}-slack-notifier`,
      runtime: Runtime.NODEJS_22_X,
      logRetention: LAMBDA_LOG_RETENTION,
      entry: path.join(here, '../lambda/slack-notifier/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(15),
      environment: {
        WEBHOOK_PARAMETER_NAME: webhookParameterName,
      },
      bundling: {
        format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
        mainFields: ['module', 'main'],
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });

    // Webhook URL は手動登録のため、パラメータ名で権限を絞る
    slackNotifier.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter${webhookParameterName}`,
        ],
      }),
    );

    this.alertTopic.addSubscription(new subscriptions.LambdaSubscription(slackNotifier));

    // Slack への通知自体が失敗すると誰も気づけないため、そこも監視する
    this.addAlarm('SlackNotifierFailure', {
      alarmName: `${prefix}-slack-notifier-failure`,
      description: 'Slack への通知に失敗しています。アラートが届かない状態です',
      metric: slackNotifier.metricErrors({ period: cdk.Duration.minutes(5), statistic: 'Sum' }),
      threshold: 1,
      evaluationPeriods: 1,
    });

    // --- AWS 側の障害・メンテナンス（AWS Health）---

    // 自分たちのコードでは直せない事象を、気づく前に受け取るための経路。
    // グローバルサービスのイベントは us-east-1 にしか来ないため、
    // 別スタック（HealthGlobalStack）から当リージョンのイベントバスへ転送している。
    // 転送されたものも同じ形でこのバスに入るので、ルールはここ1本で済む
    new events.Rule(this, 'AwsHealthRule', {
      ruleName: `${prefix}-aws-health`,
      description: 'AWS Health の障害・予定された変更を Slack へ流す',
      eventPattern: {
        source: ['aws.health'],
        detail: {
          // お知らせや調査中まで拾うと日常的に鳴ってしまうため、
          // 実際の障害と、対応が必要になる予定変更に絞る
          eventTypeCategory: ['issue', 'scheduledChange'],
        },
      },
      targets: [new targets.SnsTopic(this.alertTopic)],
    });

    // --- AI: ソムリエ（AgentCore Runtime）---

    const agentCoreDimensions = { ResourceId: props.sommelierRuntimeArn };

    // 今回の障害（正規利用者のトークンが拒否される）を検知できる本命
    for (const exceptionType of [
      'UnauthorizedInboundTokenException',
      'InvalidInboundTokenException',
    ]) {
      this.addAlarm(`SommelierAuthFailure${exceptionType}`, {
        alarmName: `${prefix}-sommelier-auth-failure-${exceptionType}`,
        description:
          'ソムリエの認証が拒否されています。利用者はチャットで「サインインの有効期限が切れたかも」と表示されます',
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Bedrock-AgentCore',
          metricName: 'InboundAuthorizationFailure',
          dimensionsMap: { ...agentCoreDimensions, ExceptionType: exceptionType },
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 3,
        evaluationPeriods: 1,
      });
    }

    this.addAlarm('SommelierSystemErrors', {
      alarmName: `${prefix}-sommelier-system-errors`,
      description: 'ソムリエ Runtime がシステムエラーを返しています',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Bedrock-AgentCore',
        metricName: 'SystemErrors',
        dimensionsMap: agentCoreDimensions,
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
    });

    this.addAlarm('SommelierThrottles', {
      alarmName: `${prefix}-sommelier-throttles`,
      description: 'ソムリエ Runtime がスロットリングされています',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Bedrock-AgentCore',
        metricName: 'Throttles',
        dimensionsMap: agentCoreDimensions,
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
    });

    // --- AI: OCR（ラベル読み取り）---

    this.addAlarm('OcrErrors', {
      alarmName: `${prefix}-ocr-errors`,
      description: 'ラベル画像の OCR が失敗しています（銘柄名の自動入力が効きません）',
      metric: props.ocrFunction.metricErrors({
        period: cdk.Duration.minutes(15),
        statistic: 'Sum',
      }),
      threshold: 3,
      evaluationPeriods: 1,
    });

    this.addAlarm('OcrThrottles', {
      alarmName: `${prefix}-ocr-throttles`,
      description: 'OCR Lambda がスロットリングされています',
      metric: props.ocrFunction.metricThrottles({
        period: cdk.Duration.minutes(15),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
    });

    this.addOcrSloAlarms(prefix, props.envName);

    // --- サービス正常性 ---

    this.addAlarm('AppSync5XX', {
      alarmName: `${prefix}-appsync-5xx`,
      description: 'GraphQL API がサーバエラーを返しています（記録の閲覧・登録に影響します）',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/AppSync',
        metricName: '5XXError',
        dimensionsMap: { GraphQLAPIId: props.graphqlApi.apiId },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 1,
    });

    for (const fn of props.functions) {
      this.addAlarm(`LambdaErrors${fn.node.id}`, {
        alarmName: `${prefix}-lambda-errors-${fn.node.id.toLowerCase()}`,
        description: `${fn.node.id} がエラーを返しています`,
        metric: fn.metricErrors({ period: cdk.Duration.minutes(15), statistic: 'Sum' }),
        threshold: 5,
        evaluationPeriods: 1,
      });
    }

    for (const table of props.tables) {
      this.addAlarm(`DynamoThrottle${table.node.id}`, {
        alarmName: `${prefix}-dynamodb-throttle-${table.node.id.toLowerCase()}`,
        description: `${table.node.id} が読み書きをスロットリングされています`,
        metric: new cloudwatch.Metric({
          namespace: 'AWS/DynamoDB',
          metricName: 'ThrottledRequests',
          dimensionsMap: { TableName: table.tableName },
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 1,
        evaluationPeriods: 1,
      });
    }

    // 以前は ApiStack 側にあり通知先が無かったため、鳴っても気づけなかった
    this.addAlarm('ImageDeleteFailAlarm', {
      alarmName: `${prefix}-image-delete-fail`,
      description: 'S3 の画像削除に繰り返し失敗しています（消したはずの画像が残ります）',
      metric: props.imageDeleteFailMetricFilter.metric({
        statistic: 'Sum',
        period: cdk.Duration.hours(1),
      }),
      threshold: 5,
      evaluationPeriods: 1,
    });

    // 新規登録の通知 Lambda は失敗してもサインアップを守るため throw しない。
    // 沈黙したままだと登録に気づけなくなるので、失敗ログから起こした
    // メトリクスで監視する（Issue #66）
    this.addAlarm('SignupNotifyFailAlarm', {
      alarmName: `${prefix}-signup-notify-fail`,
      description:
        '新規ユーザー登録の Slack 通知に失敗しています（登録自体は成功しています）',
      metric: props.signupNotifyFailMetricFilter.metric({
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
    });

    // --- 外形監視: 到達性（5分ごと）---

    const healthCheckTargets = [
      {
        name: 'frontend',
        url: props.siteUrl,
        expectStatus: [200],
      },
      {
        // 認証なしで叩き「拒否されること」を確認する。
        // 認証情報を持たずに、到達性と認証の働きを同時に見られる
        name: 'sommelier-runtime',
        url:
          `https://bedrock-agentcore.${this.region}.amazonaws.com/runtimes/` +
          `${encodeURIComponent(props.sommelierRuntimeArn)}/invocations?qualifier=DEFAULT`,
        method: 'POST',
        expectStatus: [401, 403],
      },
      {
        name: 'appsync',
        url: props.graphqlApi.graphqlUrl,
        method: 'POST',
        // 空の本文だと GraphQL の形式エラー（400）で認証まで到達しないため、
        // 最小の有効なクエリを送って「認証で拒否されること」を確かめる
        body: JSON.stringify({ query: '{__typename}' }),
        expectStatus: [401],
      },
    ];

    const healthCheck = new NodejsFunction(this, 'HealthCheckFunction', {
      functionName: `${prefix}-health-check`,
      runtime: Runtime.NODEJS_22_X,
      logRetention: LAMBDA_LOG_RETENTION,
      entry: path.join(here, '../lambda/health-check/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      environment: {
        METRIC_NAMESPACE: this.metricNamespace,
        HEALTH_CHECK_TARGETS: JSON.stringify(healthCheckTargets),
        TIMEOUT_MS: '10000',
      },
      bundling: {
        format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
        mainFields: ['module', 'main'],
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });

    healthCheck.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: { StringEquals: { 'cloudwatch:namespace': this.metricNamespace } },
      }),
    );

    new events.Rule(this, 'HealthCheckSchedule', {
      ruleName: `${prefix}-health-check-schedule`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      targets: [new targets.LambdaFunction(healthCheck)],
    });

    // 一時的な失敗で鳴らさないよう、2回続けて失敗したら通知する
    for (const target of healthCheckTargets) {
      this.addAlarm(`HealthCheckFailed${target.name}`, {
        alarmName: `${prefix}-health-check-${target.name}`,
        description: `外形監視で ${target.name} に到達できません`,
        metric: new cloudwatch.Metric({
          namespace: this.metricNamespace,
          metricName: 'HealthCheckFailed',
          dimensionsMap: { Target: target.name },
          statistic: 'Maximum',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 1,
        evaluationPeriods: 2,
      });
    }

    // --- 外形監視: ソムリエとの実会話（6時間ごと）---

    const canary = new NodejsFunction(this, 'SommelierCanaryFunction', {
      functionName: `${prefix}-sommelier-canary`,
      runtime: Runtime.NODEJS_22_X,
      logRetention: LAMBDA_LOG_RETENTION,
      entry: path.join(here, '../lambda/sommelier-canary/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(90),
      environment: {
        METRIC_NAMESPACE: this.metricNamespace,
        USER_POOL_ID: props.userPoolId,
        USER_POOL_CLIENT_ID: props.canaryUserPoolClientId,
        CREDENTIALS_SECRET_ID: canaryCredentialsSecretName,
        SOMMELIER_RUNTIME_ARN: props.sommelierRuntimeArn,
        SOMMELIER_RUNTIME_REGION: this.region,
        TIMEOUT_MS: '60000',
      },
      bundling: {
        format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
        mainFields: ['module', 'main'],
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });

    canary.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: { StringEquals: { 'cloudwatch:namespace': this.metricNamespace } },
      }),
    );
    canary.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${canaryCredentialsSecretName}-*`,
        ],
      }),
    );
    canary.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminInitiateAuth'],
        resources: [
          `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${props.userPoolId}`,
        ],
      }),
    );

    new events.Rule(this, 'SommelierCanarySchedule', {
      ruleName: `${prefix}-sommelier-canary-schedule`,
      // 毎回 LLM を呼ぶため、頻度を抑えて費用を小さくする
      schedule: events.Schedule.rate(cdk.Duration.hours(6)),
      targets: [new targets.LambdaFunction(canary)],
    });

    this.addAlarm('SommelierCanaryFailed', {
      alarmName: `${prefix}-sommelier-canary`,
      description:
        'ソムリエに実際に相談できませんでした（認証または応答に失敗）。' +
        '初回デプロイ直後なら、agentcore.json の allowedClients と COGNITO_APP_CLIENT_ID に' +
        'カナリア用クライアントを登録し忘れていないか確認してください',
      metric: new cloudwatch.Metric({
        namespace: this.metricNamespace,
        metricName: 'SommelierCanaryFailed',
        statistic: 'Maximum',
        period: cdk.Duration.hours(6),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      // 6時間に1度しか計測しないため、次の計測までの空白を「異常なし」と
      // みなすと、直っていないのに復旧扱いになってしまう。状態を保たせる
      treatMissingData: cloudwatch.TreatMissingData.MISSING,
    });

    // 監視そのものが動かなくなると異常に気づけないため、実行側も監視する。
    // 「エラーで失敗した」だけでなく「そもそも動いていない」も見る必要がある
    // （スケジュールが止まるとエラーすら記録されず、静かに監視が消える）
    for (const watcher of [
      {
        fn: healthCheck,
        key: 'health-check',
        label: '外形監視',
        // 5分ごとに動くので、1時間あれば必ず実行されている
        silenceWindow: cdk.Duration.hours(1),
      },
      {
        fn: canary,
        key: 'sommelier-canary',
        label: 'ソムリエのカナリア',
        // 6時間ごとなので、12時間あれば必ず実行されている
        silenceWindow: cdk.Duration.hours(12),
      },
    ]) {
      this.addAlarm(`WatcherFailure-${watcher.key}`, {
        alarmName: `${prefix}-watcher-failure-${watcher.key}`,
        description: `${watcher.label}の実行自体が失敗しています。異常を検知できない状態です`,
        metric: watcher.fn.metricErrors({
          period: cdk.Duration.hours(1),
          statistic: 'Sum',
        }),
        threshold: 1,
        evaluationPeriods: 1,
      });

      this.addAlarm(`WatcherSilent-${watcher.key}`, {
        alarmName: `${prefix}-watcher-silent-${watcher.key}`,
        description:
          `${watcher.label}が動いていません。スケジュールの停止や権限の失効が疑われます`,
        metric: watcher.fn.metricInvocations({
          period: watcher.silenceWindow,
          statistic: 'Sum',
        }),
        threshold: 1,
        evaluationPeriods: 1,
        // 発報の実体は下の BREACHING。Lambda の Invocations は呼び出しが無いと
        // 0 ではなく「記録なし」になるため、沈黙は必ず欠損として現れる。
        // 比較演算子は、将来 0 を明示的に出す指標に替えても意図が保たれるように残す
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        // 記録が無い＝一度も動いていない、とみなして異常にする
        treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      });
    }

    new cdk.CfnOutput(this, 'AlertTopicArn', {
      value: this.alertTopic.topicArn,
      description: '監視アラートの SNS トピック',
    });
    new cdk.CfnOutput(this, 'SlackWebhookParameterName', {
      value: webhookParameterName,
      description: 'Slack Webhook URL を入れる SSM パラメータ名（手動登録）',
    });
    new cdk.CfnOutput(this, 'CanaryCredentialsSecretName', {
      value: canaryCredentialsSecretName,
      description: '監視ユーザーの認証情報を入れる Secrets Manager 名（手動登録）',
    });
  }

  /**
   * アラームを作って通知先を繋ぐ。
   * 復旧も通知するので、鳴りっぱなしか直ったかが Slack だけで分かる。
   */
  /**
   * OCR の SLO を定義する（Issue #86）。
   *
   * 対象は `analyzeSakeLabel` を実行する `ocr-analyzer` だけ。`presigned-url` は
   * 計装が 2026-08-16 に入ったばかりで、しきい値を決める材料が無いので後回し。
   * SLO は Application Signals の課金対象なので、増やすときは理由を持って増やす。
   *
   * ## なぜ既存のアラームがあるのに要るか
   *
   * `ocr-errors` は「15分で3件以上」で鳴る。まとまって落ちたときには効くが、
   * **ぽつぽつ失敗するのは素通りする**。実際 Issue #115 は24時間で12回中3回の
   * 失敗（エラー率 25%）で、このアラームは一度も鳴っていない。
   * 30日の budget で見ると、そういう緩やかな失敗が可視化される。
   *
   * ## しきい値の根拠
   *
   * 利用者が本人だけで、実績は日に数回。厳しくしても鳴りっぱなしになるだけなので
   * 90% に置いた。30日で 90 リクエスト程度、失敗 9 回までが budget の中に入る。
   *
   * レイテンシーのしきい値は実測から。2026-08-11〜16 の日次はこうなっている。
   *
   * | | p50 | p90 | p99 |
   * |---|---|---|---|
   * | 実測（ミリ秒） | 4619〜7137 | 4764〜8006 | 最大 8146 |
   *
   * **`ApplicationSignals` の `Latency` はミリ秒**（`get-metric-statistics` の
   * 応答が `Unit: Milliseconds` を返し、生値も上のとおり4桁）。したがって
   * 下の `metricThreshold: 15000` は 15 秒を表す。秒だと思って 15 を入れると
   * 15 ミリ秒になり、達成率が常に 0% に張り付く。逆にミリ秒の値を秒として
   * 読むと 15000 秒（約4時間）と誤読されるので、単位はここに明記しておく
   * （PR #161 のレビューで実際に誤読された）。
   *
   * 所要時間の大半は Bedrock なので画像の大きさで振れる。8 秒台の実測に対して
   * 10 秒だと余裕が 2 秒しかなく揺れで鳴るため、倍近い余裕を取って 15 秒とする。
   * ここを割るのは「いつもより明らかに遅い」ときだけでよい。
   *
   * ## 種別を request-based にしている理由
   *
   * period-based は「期間ごとに good / bad を判定して、good な期間の割合」を見る。
   * 日に数回しか呼ばれないと、ほとんどの期間がデータ無しになって判定が成り立たない。
   * request-based は「リクエストの成功割合」を直接数えるので、疎なトラフィックでも
   * 意味のある値になる。
   */
  /**
   * OCR の SLO 名を組み立てる唯一の場所（Issue #86）。
   *
   * SLO の `name` と、アラームの `SloName` ディメンションは一致していないと
   * いけない。ずれるとアラームは `INSUFFICIENT_DATA` のまま居座り、
   * 「監視が入っている」ように見えて何も鳴らない。合成もデプロイも成功するので、
   * 気づく手立てが無い。
   *
   * 定義側とアラーム側でそれぞれ文字列を書いていると、名前を変えるときに
   * 片方だけ直して壊せる。ここを通してしか作らせない（PR #165 のレビュー指摘）。
   */
  private static ocrSloNames(envName: string): {
    serviceName: string;
    availability: string;
    latency: string;
  } {
    const serviceName = `${envName}-sakekasu-ocr-analyzer`;
    return {
      serviceName,
      availability: `${serviceName}-availability`,
      latency: `${serviceName}-latency`,
    };
  }

  private addOcrServiceLevelObjectives(envName: string): void {
    const { serviceName, availability, latency } = MonitoringStack.ocrSloNames(envName);
    // Application Signals が Lambda のサービスに付ける環境名。実機の
    // メトリクスのディメンションから取っている（推測で書くと SLO が
    // 対象を見つけられず、達成率が空のまま出来上がる）
    const keyAttributes = {
      Type: 'Service',
      Name: serviceName,
      Environment: 'lambda:default',
    };

    // 30日の rolling。カレンダー月にしないのは、月初にバジェットが戻る形だと
    // 月末の失敗を見落としやすいため
    const goal = (attainmentGoal: number): applicationsignals.CfnServiceLevelObjective.GoalProperty => ({
      attainmentGoal,
      interval: { rollingInterval: { duration: 30, durationUnit: 'DAY' } },
    });

    // バーンレートの参照窓。日に数回しか呼ばれないので、1時間窓だとほとんどが
    // データ無しになる。1日窓だけにする
    const burnRateConfigurations = [{ lookBackWindowMinutes: 1440 }];

    new applicationsignals.CfnServiceLevelObjective(this, 'OcrAvailabilitySlo', {
      name: availability,
      exclusionWindows: [SLO_EXCLUSION_WINDOW],
      description: 'ラベル OCR の成功率（30日で 90%）。ぽつぽつ失敗し続ける状態を見つけるためのもの',
      burnRateConfigurations,
      goal: goal(SLO_ATTAINMENT_GOAL),
      requestBasedSli: {
        requestBasedSliMetric: { keyAttributes, metricType: 'AVAILABILITY' },
      },
    });

    new applicationsignals.CfnServiceLevelObjective(this, 'OcrLatencySlo', {
      name: latency,
      exclusionWindows: [SLO_EXCLUSION_WINDOW],
      description: 'ラベル OCR の所要時間（30日で 90% が 15 秒未満）。大半は Bedrock の時間',
      burnRateConfigurations,
      goal: goal(SLO_ATTAINMENT_GOAL),
      requestBasedSli: {
        comparisonOperator: 'LessThan',
        // ミリ秒。15 秒（単位の根拠はこのメソッドの説明を参照）
        metricThreshold: 15000,
        requestBasedSliMetric: { keyAttributes, metricType: 'LATENCY' },
      },
    });
  }

  /**
   * SLO を割ったときのアラーム（Issue #86）。
   *
   * 上の `ocr-errors` は「15分で3件以上」で鳴る。まとまって落ちたときには
   * 効くが、ぽつぽつ失敗するのは素通りする。Issue #115 は24時間で12回中3回の
   * 失敗だったが、このアラームは一度も鳴っていない。そこを埋める。
   *
   * ## バーンレートではなく達成率を見る
   *
   * バーンレートは「エラー率 ÷ (100% − 目標)」なので、日に数回の規模だと
   * 1回の失敗で 3.3 まで跳ねる。必ず鳴る形は「30日で9回まで許容する」という
   * budget の設計と噛み合わない。
   *
   * `AttainmentRate` は30日の成功率そのものなので、1回の失敗（90回中1回）では
   * 動かず、失敗が積み上がったときだけ 90 を割る。狙っている信号はこちら。
   *
   * ## 名前空間について
   *
   * `AWS/ApplicationSignals` と `AWS/AppSignals` の両方に、同じメトリクス名・
   * 同じディメンションで**同じ値**が出る（実測で確認）。別名と思われる。
   * サービスの正式名に合うほうを使う。片方が将来消えるようなら、そのとき
   * アラームがデータ無しになるので気づける。
   *
   * ディメンションは `SloName` だけ。`applicationsignals.CfnServiceLevelObjective`
   * に付けた `name` と一致していないと、アラームは INSUFFICIENT_DATA のまま
   * 居座る。監視が入っているように見えて何も鳴らない状態になるので、
   * 名前は `ocrSloNames()` からしか作らない。
   */
  private addOcrSloAlarms(prefix: string, envName: string): void {
    const { availability, latency } = MonitoringStack.ocrSloNames(envName);

    const slos = [
      {
        id: 'OcrAvailabilitySloBreach',
        sloName: availability,
        alarmName: `${prefix}-ocr-slo-availability`,
        description:
          'OCR の成功率が30日で 90% を割りました（1回きりの失敗ではなく、失敗が積み上がっています）',
      },
      {
        id: 'OcrLatencySloBreach',
        sloName: latency,
        alarmName: `${prefix}-ocr-slo-latency`,
        description: 'OCR の所要時間が30日で 90% の呼び出しで 15 秒を超えています',
      },
    ];

    for (const slo of slos) {
      this.addAlarm(slo.id, {
        alarmName: slo.alarmName,
        description: slo.description,
        metric: new cloudwatch.Metric({
          namespace: 'AWS/ApplicationSignals',
          metricName: 'AttainmentRate',
          dimensionsMap: { SloName: slo.sloName },
          // 値は30日の rolling なので動きが遅い。5分ごとに出ているが、
          // そのまま見ると状態が細かく揺れるので1時間で均す
          period: cdk.Duration.hours(1),
          statistic: 'Average',
        }),
        threshold: SLO_ATTAINMENT_GOAL,
        evaluationPeriods: 1,
        // 目標を「下回ったら」異常。既定は「以上で異常」なので明示する
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        // データが途切れても状態を保つ。既定（異常なし）だと、SLO の値が
        // 出なくなった瞬間に「復旧した」と誤って判定されてしまう
        treatMissingData: cloudwatch.TreatMissingData.MISSING,
      });
    }
  }

  private addAlarm(
    id: string,
    options: {
      alarmName: string;
      description: string;
      metric: cloudwatch.IMetric;
      threshold: number;
      evaluationPeriods: number;
      /**
       * データが無い期間の扱い。既定は「異常なし」。
       * ただし、たまにしか計測しない指標（カナリアなど）でこれを使うと、
       * 異常のまま次の計測を待つ間に「復旧」と判定されてしまうため、
       * そうした指標では MISSING を指定して状態を保たせる
       */
      treatMissingData?: cloudwatch.TreatMissingData;
      /** 既定は「しきい値以上で異常」。下回ったら異常にしたい指標で使う */
      comparisonOperator?: cloudwatch.ComparisonOperator;
    },
  ): cloudwatch.Alarm {
    // 通知先を作る前に呼ばれると undefined を読んで落ちる。TypeScript は
    // コンストラクタ内の代入順までは見てくれないので、ここで弾く。
    // 落ちること自体は合成時に分かるが、素の TypeError だと原因が読み取れない
    // （PR #165 のレビュー指摘）
    if (!this.alertTopic) {
      throw new Error(
        `${id}: 通知先（alertTopic）を作る前にアラームを追加している。` +
          'addAlarm の呼び出しをトピックの生成より後ろに移すこと',
      );
    }

    const alarm = new cloudwatch.Alarm(this, id, {
      alarmName: options.alarmName,
      alarmDescription: options.description,
      metric: options.metric,
      threshold: options.threshold,
      evaluationPeriods: options.evaluationPeriods,
      comparisonOperator:
        options.comparisonOperator ??
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      // 呼び出しが無い時間帯にデータ欠損で鳴らさない
      treatMissingData: options.treatMissingData ?? cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    alarm.addAlarmAction(new actions.SnsAction(this.alertTopic));
    alarm.addOkAction(new actions.SnsAction(this.alertTopic));
    return alarm;
  }
}
