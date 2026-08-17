import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as path from 'node:path';
import * as url from 'node:url';
import type { Construct } from 'constructs';
import { lambdaLogGroup } from './log-retention.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));

export interface BillingNotifierStackProps extends cdk.StackProps {
  /** レポートで個別に表示するアカウント。先頭から順に表示される */
  targetAccounts: { id: string; label: string }[];
}

/**
 * 毎日の AWS 利用料金を Slack へ通知するスタック（Issue #92）。
 *
 * Cost Explorer でアカウント別の内訳（LINKED_ACCOUNT）を見られるのは
 * Organization の管理アカウントだけのため、このスタックは他と違い
 * **管理アカウントへデプロイする**。環境（dev/staging/prod）にも紐づかない。
 *
 * 通知先の Slack Webhook URL はリポジトリに置けないため、デプロイ前に
 * 手動で登録した SSM パラメータを名前で参照する（README の手順を参照）
 */
export class BillingNotifierStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BillingNotifierStackProps) {
    super(scope, id, props);

    const prefix = 'sakekasu-billing';
    const webhookParameterName = `/${prefix}/slack-webhook-url`;

    const bundling = {
      format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
      mainFields: ['module', 'main'],
      banner:
        "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
    };

    const webhookParameterArn =
      `arn:aws:ssm:${this.region}:${this.account}:parameter${webhookParameterName}`;

    // --- 毎日のレポート本体 ---

    const billingNotifierFunctionName = `${prefix}-notifier`;
    const billingNotifier = new NodejsFunction(this, 'BillingNotifierFunction', {
      functionName: billingNotifierFunctionName,
      runtime: Runtime.NODEJS_22_X,
      logGroup: lambdaLogGroup(this, 'BillingNotifierLogGroup', billingNotifierFunctionName),
      entry: path.join(here, '../lambda/billing-notifier/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      environment: {
        WEBHOOK_PARAMETER_NAME: webhookParameterName,
        TARGET_ACCOUNTS: JSON.stringify(props.targetAccounts),
      },
      bundling,
    });

    // Cost Explorer はリソース単位の絞り込みに対応していないため * にする
    billingNotifier.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ce:GetCostAndUsage'],
        resources: ['*'],
      }),
    );
    billingNotifier.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [webhookParameterArn],
      }),
    );

    // 毎日 09:05 JST（00:05 UTC）。00:00 ちょうどを避けるのは、
    // 「1日1回動いたか」を見るアラームの集計窓（UTC 日単位）に確実に収めるため
    new events.Rule(this, 'DailyReportSchedule', {
      ruleName: `${prefix}-daily-schedule`,
      description: '毎日の AWS 利用料金レポートを Slack へ送る',
      schedule: events.Schedule.cron({ minute: '5', hour: '0' }),
      targets: [new targets.LambdaFunction(billingNotifier)],
    });

    // --- レポートが止まったことに気づくための監視 ---

    // 管理アカウントには既存の監視スタックが無いため、通知経路もここに持つ。
    // Slack 通知 Lambda は監視スタックと同じ実装を再利用する
    const alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: `${prefix}-alerts`,
      displayName: '酒カス 利用料金レポートの監視',
    });

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
      bundling,
    });
    slackNotifier.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [webhookParameterArn],
      }),
    );
    alertTopic.addSubscription(new subscriptions.LambdaSubscription(slackNotifier));

    this.addAlarm(alertTopic, 'BillingNotifierFailure', {
      alarmName: `${prefix}-notifier-failure`,
      description: '利用料金レポートの送信に失敗しています',
      metric: billingNotifier.metricErrors({
        period: cdk.Duration.hours(1),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
    });

    // エラーすら出ずに止まる（スケジュール停止など）ことにも気づけるようにする。
    // Lambda の Invocations は呼び出しが無いと「記録なし」になるため、
    // 沈黙は欠損（BREACHING）として現れる
    this.addAlarm(alertTopic, 'BillingNotifierSilent', {
      alarmName: `${prefix}-notifier-silent`,
      description:
        '利用料金レポートが1日以上動いていません。スケジュールの停止や権限の失効が疑われます',
      metric: billingNotifier.metricInvocations({
        period: cdk.Duration.days(1),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });

    this.addAlarm(alertTopic, 'SlackNotifierFailure', {
      alarmName: `${prefix}-slack-notifier-failure`,
      description: 'Slack への通知に失敗しています。アラートが届かない状態です',
      metric: slackNotifier.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
    });

    new cdk.CfnOutput(this, 'SlackWebhookParameterName', {
      value: webhookParameterName,
      description: 'Slack Webhook URL を入れる SSM パラメータ名（手動登録）',
    });
  }

  /** アラームを作って通知先を繋ぐ。復旧も通知する（監視スタックと同じ方針） */
  private addAlarm(
    topic: sns.Topic,
    id: string,
    options: {
      alarmName: string;
      description: string;
      metric: cloudwatch.IMetric;
      threshold: number;
      evaluationPeriods: number;
      treatMissingData?: cloudwatch.TreatMissingData;
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
      treatMissingData: options.treatMissingData ?? cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    alarm.addAlarmAction(new actions.SnsAction(topic));
    alarm.addOkAction(new actions.SnsAction(topic));
    return alarm;
  }
}
