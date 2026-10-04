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
import { lambdaLogGroup } from './log-retention.js';
import { applyRoleBoundary } from './role-boundary.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));

/**
 * SLO の目標達成率（Issue #86）。
 *
 * SLO の定義とアラームのしきい値で同じ値を使う。別々に書くと、片方だけ
 * 動かしたときに「SLO は 95% を目標にしているのにアラームは 90% で鳴る」
 * のような食い違いが黙って生まれる。
 *
 * 90% にしている理由は `addServiceLevelObjectives()` の説明を参照。
 */
const SLO_ATTAINMENT_GOAL = 90;

/**
 * SLO を付ける関数（Issue #86）。
 *
 * `idPrefix` は CloudFormation の論理 ID に入る。**既存のものは変えない。**
 * 変えると SLO が作り直され、30日ぶんの達成率の履歴が消える。見た目には
 * 成功するデプロイで観測が巻き戻るので、気づくのはアラームが鳴るべき
 * ときに鳴らなかったあとになる。
 *
 * `latencyThresholdMs` は実測から決める。勘で置くと、鳴りっぱなしか
 * 永久に鳴らないかのどちらかになる。根拠は下の表のとおり。
 *
 * | 関数 | 30日の件数 | p99 | 最大 | しきい値 |
 * |---|---|---|---|---|
 * | `ocr-analyzer` | — | — | — | 15,000ms（Bedrock の時間が大半） |
 * | `presigned-url` | 172 | 476〜1,030ms | 1,041ms | 2,000ms |
 *
 * `presigned-url` は実測の最大に対して約2倍の余裕を取ってある。なお
 * Application Signals の `Latency` も Lambda の `Duration` も Init Duration を
 * 含まない（2026-10-03 実測、最大 1,041ms / 1,085ms でほぼ一致）ため、
 * コールドスタート（計装込みで 1.1〜1.2 秒）の分を上積みする必要は無い。
 */
const SLO_TARGETS = [
  {
    idPrefix: 'Ocr',
    functionSlug: 'ocr-analyzer',
    alarmSlug: 'ocr',
    subject: 'ラベル OCR の',
    latencyThresholdMs: 15000,
    latencyNote: '大半は Bedrock の時間',
  },
  {
    idPrefix: 'PresignedUrl',
    functionSlug: 'presigned-url',
    alarmSlug: 'presigned-url',
    subject: '画像アップロード URL 発行の',
    latencyThresholdMs: 2000,
    latencyNote: 'S3 への API 呼び出しの時間',
  },
] as const;

type SloTarget = (typeof SLO_TARGETS)[number];

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
  /** ソムリエ Runtime の ARN */
  sommelierRuntimeArn: string;
  /** フロントの公開 URL（外形監視の対象） */
  siteUrl: string;
}

/**
 * 監視とアラート通知をまとめたスタック。
 *
 * 通知先の Slack Webhook URL はリポジトリに置けないため、デプロイ前に
 * 手動で登録した SSM パラメータを名前で参照する（README の手順を参照）。
 */
export class MonitoringStack extends cdk.Stack {
  public readonly alertTopic: sns.Topic;

  /** 外形監視が書き込むカスタムメトリクスの名前空間 */
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
    this.addServiceLevelObjectives(props.envName);

    // --- 通知経路 ---

    this.alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: `${prefix}-alerts`,
      displayName: '酒カス 監視アラート',
    });

    // CloudWatch アラームからの publish を明示的に許可する。
    //
    // ## なぜ要るか
    //
    // SNS はトピック作成時に「所有アカウントからの publish を許可する」既定ポリシーを
    // 暗黙に持っていて、アラーム通知はこれに乗っている。だがこの既定は
    // 明示的なトピックポリシーを置いた瞬間に丸ごと置き換わる。
    // 以前は AWS Health のルール（EventBridge）がこのトピックを宛先にしていて、
    // CDK が events.amazonaws.com を許可する AWS::SNS::TopicPolicy を生成し、
    // その副作用でアラーム側の権限が落ちた。
    //
    // Health のルールは共通基盤へ移して無くなったが、この文は外さない。
    // 暗黙の既定に戻すのではなく明示しておけば、将来また別のサービス
    // （EventBridge など）を宛先に足しても、この文だけは残る。
    // ここを消してから何かを宛先に足すと、同じ無音の事故がもう一度起きる。
    //
    // ## 実際に一度壊した（2026-08-06 〜 08-17）
    //
    // AWS Health のルール（当時は AwsHealthRule）を入れた 08-06 から、このスタックの
    // アラーム全部が無音になった。鳴ってはいるが誰にも届かない状態で、9日間気づけなかった。
    // EventBridge 経由の AWS Health 通知だけは許可が残っていて届き続けたため、
    // 通知が来ること自体は日常的に起きていたのが、気づけなかった理由。
    //
    // 失われた通知の実例として、08-08 12:46 の signup-notify-fail がある。
    // 表に出たのは 08-17、Application Signals の SLO アラーム（Issue #86）が
    // 初めて遷移したときだった。
    //
    // ## 壊れているかの見分け方
    //
    // アラームの状態ではなく、アクションの履歴を見る。状態は正常に遷移するので、
    // describe-alarms では気づけない。
    //
    //   aws cloudwatch describe-alarm-history --alarm-name <name> \
    //     --history-item-type Action --query 'AlarmHistoryItems[].[Timestamp,HistorySummary]'
    //
    // Failed to execute action が出ていれば拒否されている。
    // 経路を試すなら set-alarm-state で状態を手で動かすのが早い（実通知が飛ぶ）。
    //
    // 対処の出典:
    // https://repost.aws/knowledge-center/cloudwatch-receive-sns-for-alarm-trigger
    this.alertTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowCloudWatchAlarmsToPublish',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('cloudwatch.amazonaws.com')],
        actions: ['sns:Publish'],
        resources: [this.alertTopic.topicArn],
        // 混乱した代理人対策。ただし条件は、CloudWatch が渡すと AWS の手順書に
        // 明記されているキーだけに留める。推測で絞ると「鳴っているのに届かない」
        // という、いま踏んだのと同じ壊れ方をする
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnLike: {
            'aws:SourceArn': `arn:aws:cloudwatch:${this.region}:${this.account}:alarm:*`,
          },
        },
      }),
    );

    const slackNotifierFunctionName = `${prefix}-slack-notifier`;
    const slackNotifier = new NodejsFunction(this, 'SlackNotifierFunction', {
      functionName: slackNotifierFunctionName,
      runtime: Runtime.NODEJS_22_X,
      logGroup: lambdaLogGroup(this, 'SlackNotifierLogGroup', slackNotifierFunctionName),
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

    // AWS Health の通知は共通基盤（sakekasu-integrated_environment）へ移した。
    // アカウント全体の話なので 1 か所だけが持つ。ここにも残すと同じ通知が 2 通届く

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

    this.addSloAlarms(prefix, props.envName);

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

    /*
     * DynamoDB のスロットリングは、テーブル単位で出る ReadThrottleEvents と WriteThrottleEvents の和で見る。
     *
     * 以前は ThrottledRequests を TableName だけで見ていたが、この指標は TableName と Operation の
     * 組でしか出ない。次元が一致しない指標はデータが無い扱いになり、NOT_BREACHING なので
     * 一度も鳴らない状態だった。アラーム名と論理 ID は変えず、見る指標だけを差し替える。
     * 片方だけ出ている期間に式全体が欠損にならないよう、FILL で 0 を埋めてから足す。
     */
    const throttleEvents = (tableName: string, metricName: string) =>
      new cloudwatch.Metric({
        namespace: 'AWS/DynamoDB',
        metricName,
        dimensionsMap: { TableName: tableName },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      });
    for (const table of props.tables) {
      this.addAlarm(`DynamoThrottle${table.node.id}`, {
        alarmName: `${prefix}-dynamodb-throttle-${table.node.id.toLowerCase()}`,
        description: `${table.node.id} が読み書きをスロットリングされています`,
        metric: new cloudwatch.MathExpression({
          expression: 'FILL(r, 0) + FILL(w, 0)',
          usingMetrics: {
            r: throttleEvents(table.tableName, 'ReadThrottleEvents'),
            w: throttleEvents(table.tableName, 'WriteThrottleEvents'),
          },
          label: 'ThrottleEvents',
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

    const healthCheckFunctionName = `${prefix}-health-check`;
    const healthCheck = new NodejsFunction(this, 'HealthCheckFunction', {
      functionName: healthCheckFunctionName,
      runtime: Runtime.NODEJS_22_X,
      logGroup: lambdaLogGroup(this, 'HealthCheckLogGroup', healthCheckFunctionName),
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
   * SLO 名を組み立てる唯一の場所（Issue #86）。
   *
   * SLO の `name` と、アラームの `SloName` ディメンションは一致していないと
   * いけない。ずれるとアラームは `INSUFFICIENT_DATA` のまま居座り、
   * 「監視が入っている」ように見えて何も鳴らない。合成もデプロイも成功するので、
   * 気づく手立てが無い。
   *
   * 定義側とアラーム側でそれぞれ文字列を書いていると、名前を変えるときに
   * 片方だけ直して壊せる。ここを通してしか作らせない（PR #165 のレビュー指摘）。
   *
   * サービス名は Application Signals が実機で付けている名前（Lambda の関数名）と
   * 一致していないといけない。ここがずれると SLO が対象を見つけられず、
   * 達成率が空のまま出来上がる。
   */
  private static sloNames(
    envName: string,
    target: SloTarget,
  ): {
    serviceName: string;
    availability: string;
    latency: string;
  } {
    const serviceName = `${envName}-sakekasu-${target.functionSlug}`;
    return {
      serviceName,
      availability: `${serviceName}-availability`,
      latency: `${serviceName}-latency`,
    };
  }

  private addServiceLevelObjectives(envName: string): void {
    for (const target of SLO_TARGETS) {
      this.addServiceLevelObjectivesFor(envName, target);
    }
  }

  private addServiceLevelObjectivesFor(envName: string, target: SloTarget): void {
    const { serviceName, availability, latency } = MonitoringStack.sloNames(envName, target);
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

    new applicationsignals.CfnServiceLevelObjective(this, `${target.idPrefix}AvailabilitySlo`, {
      name: availability,
      description:
        `${target.subject}成功率（30日で ${SLO_ATTAINMENT_GOAL}%）。` +
        'ぽつぽつ失敗し続ける状態を見つけるためのもの',
      burnRateConfigurations,
      goal: goal(SLO_ATTAINMENT_GOAL),
      requestBasedSli: {
        requestBasedSliMetric: { keyAttributes, metricType: 'AVAILABILITY' },
      },
    });

    new applicationsignals.CfnServiceLevelObjective(this, `${target.idPrefix}LatencySlo`, {
      name: latency,
      description:
        `${target.subject}所要時間（30日で ${SLO_ATTAINMENT_GOAL}% が ` +
        `${target.latencyThresholdMs / 1000} 秒未満）。${target.latencyNote}`,
      burnRateConfigurations,
      goal: goal(SLO_ATTAINMENT_GOAL),
      requestBasedSli: {
        comparisonOperator: 'LessThan',
        // ミリ秒（単位の根拠はこのメソッドの説明を参照）。値の根拠は SLO_TARGETS
        metricThreshold: target.latencyThresholdMs,
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
   * 名前は `sloNames()` からしか作らない。
   */
  private addSloAlarms(prefix: string, envName: string): void {
    const slos = SLO_TARGETS.flatMap((target) => {
      const { availability, latency } = MonitoringStack.sloNames(envName, target);
      return [
        {
          id: `${target.idPrefix}AvailabilitySloBreach`,
          sloName: availability,
          alarmName: `${prefix}-${target.alarmSlug}-slo-availability`,
          description:
            `${target.subject}成功率が30日で ${SLO_ATTAINMENT_GOAL}% を割りました` +
            '（1回きりの失敗ではなく、失敗が積み上がっています）',
        },
        {
          id: `${target.idPrefix}LatencySloBreach`,
          sloName: latency,
          alarmName: `${prefix}-${target.alarmSlug}-slo-latency`,
          description:
            `${target.subject}所要時間が30日で ${SLO_ATTAINMENT_GOAL}% の呼び出しで ` +
            `${target.latencyThresholdMs / 1000} 秒を超えています`,
        },
      ];
    });

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
       * ただし、動きの遅い指標（30日の rolling で見る SLO の達成率など）でこれを使うと、
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
