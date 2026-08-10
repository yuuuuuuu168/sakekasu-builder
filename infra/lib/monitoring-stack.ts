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
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as path from 'node:path';
import * as url from 'node:url';
import type { Construct } from 'constructs';
import { LAMBDA_LOG_RETENTION } from './log-retention.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));

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
