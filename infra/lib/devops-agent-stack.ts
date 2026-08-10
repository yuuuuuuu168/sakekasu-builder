import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as path from 'node:path';
import * as url from 'node:url';
import type { Construct } from 'constructs';

const here = path.dirname(url.fileURLToPath(import.meta.url));

export interface DevOpsAgentStackProps extends cdk.StackProps {
  /** 環境名（dev, staging, prod） */
  envName: string;
  /** Agent Space を置いたプライマリアカウントの ID */
  monitoringAccountId: string;
  /** 信頼する Agent Space の ARN。1つのスペースだけに絞る */
  agentSpaceArn: string;
  /** 調査のきっかけを流す SNS トピック（監視スタックのもの） */
  alertTopic: sns.ITopic;
}

/**
 * AWS DevOps Agent 連携のスタック（Issue #67）。
 *
 * Agent Space 自体は運用ツール用のアカウント（<運用アカウント ID> / ops-tooling）の
 * コンソールで作る。
 * このスタックが持つのは、**アプリ本体のアカウント側に必要なもの**の2つ:
 *
 * - **調査用のクロスアカウントロール**: DevOps Agent のサービスプリンシパルが
 *   直接引き受ける読み取り専用ロール。信頼条件を Agent Space の ARN に絞って
 *   混乱した代理人（confused deputy）を防ぐ
 * - **アラーム転送 Lambda**: 既存のアラートトピックを購読し、発報を
 *   DevOps Agent の Webhook に投げて調査を自動で始めさせる
 *
 * Agent Space の ARN が決まって初めて意味を持つため、コンテキストに
 * `agentSpaceArn` が入っているときだけ合成される（README の手順を参照）。
 * Webhook の URL と署名鍵はリポジトリに置けないので、デプロイ前に手動登録した
 * Secrets Manager を名前で参照する。
 */
export class DevOpsAgentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DevOpsAgentStackProps) {
    super(scope, id, props);

    const prefix = `${props.envName}-sakekasu`;
    const webhookSecretName = `${prefix}/devops-agent/webhook`;

    // --- 調査用のクロスアカウントロール（読み取り専用） ---

    // アクション実行用（Operator）は作らない。まず調査だけを任せ、
    // 実行が必要になった時点で最小権限で足す（Issue #67 の方針）
    const monitoringRole = new iam.Role(this, 'MonitoringRole', {
      roleName: `${prefix}-devops-agent-monitoring`,
      // IAM の description は ASCII + Latin-1 のみ（日本語を入れるとデプロイが 400 で落ちる）
      description: 'Read-only role assumed by AWS DevOps Agent for cross-account investigation',
      assumedBy: new iam.ServicePrincipal('aidevops.amazonaws.com', {
        conditions: {
          // プライマリアカウントの、しかもこの Agent Space からの
          // 引き受けだけを許す。どちらか片方だけでは絞りきれない
          StringEquals: { 'aws:SourceAccount': props.monitoringAccountId },
          // 渡すのは Agent Space の完全な ARN なので、ワイルドカードを解釈する
          // ArnLike ではなく ArnEquals で受ける。ARN に * や ? が紛れ込んでも
          // 別のスペースまで引き受けを許してしまうことがない
          ArnEquals: { 'aws:SourceArn': props.agentSpaceArn },
        },
      }),
      managedPolicies: [
        // 調査に必要な読み取り権限一式。AWS が保守しており、機能追加に追随する
        iam.ManagedPolicy.fromAwsManagedPolicyName('AIDevOpsAgentAccessPolicy'),
      ],
    });

    // リソースの棚卸しに Resource Explorer を使うため、その
    // サービスリンクロールの作成だけを別途許可する
    monitoringRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AllowCreateServiceLinkedRoles',
        actions: ['iam:CreateServiceLinkedRole'],
        resources: [
          `arn:aws:iam::${this.account}:role/aws-service-role/` +
            'resource-explorer-2.amazonaws.com/AWSServiceRoleForResourceExplorer',
        ],
      }),
    );

    // --- アラーム → Webhook の転送 ---

    const selfAlarmName = `${prefix}-devops-agent-webhook-failure`;

    const webhookForwarder = new NodejsFunction(this, 'WebhookForwarderFunction', {
      functionName: `${prefix}-devops-agent-webhook`,
      runtime: Runtime.NODEJS_22_X,
      entry: path.join(here, '../lambda/devops-agent-webhook/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(20),
      // 同時に走る本数を抑える。エージェントは秒課金なので、アラームが一斉に
      // 鳴ったときに調査が同時に立ち上がるのを避けたい。SNS からの呼び出しは
      // 非同期なので、絞っても捨てられずキューで順番待ちになるだけで済む。
      // なお、これは同時に始まる本数の話であって、調査の総数の上限ではない
      reservedConcurrentExecutions: 2,
      environment: {
        WEBHOOK_SECRET_ID: webhookSecretName,
        ENV_NAME: props.envName,
        // 転送の失敗を転送し返して調査を起こさないよう、自分の失敗アラームは捨てる
        SELF_ALARM_NAME: selfAlarmName,
        SERVICE_NAME: 'sakekasu-builder',
      },
      bundling: {
        format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
        mainFields: ['module', 'main'],
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });

    webhookForwarder.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${webhookSecretName}-*`,
        ],
      }),
    );

    props.alertTopic.addSubscription(new subscriptions.LambdaSubscription(webhookForwarder));

    // 転送が止まると調査が始まらないまま静かに機能を失うため、そこも監視する。
    // 通知経路は既存のアラートトピック（＝ Slack）をそのまま使う
    const failureAlarm = new cloudwatch.Alarm(this, 'WebhookForwarderFailure', {
      alarmName: selfAlarmName,
      alarmDescription:
        'DevOps Agent への調査依頼の転送に失敗しています。アラートは Slack に届きますが、自動調査は始まりません',
      metric: webhookForwarder.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    failureAlarm.addAlarmAction(new actions.SnsAction(props.alertTopic));
    failureAlarm.addOkAction(new actions.SnsAction(props.alertTopic));

    new cdk.CfnOutput(this, 'MonitoringRoleArn', {
      value: monitoringRole.roleArn,
      description: 'DevOps Agent のコンソールでセカンダリソースに登録するロール ARN',
    });
    new cdk.CfnOutput(this, 'WebhookSecretName', {
      value: webhookSecretName,
      description: 'Webhook の URL と署名鍵を入れる Secrets Manager 名（手動登録）',
    });
  }
}
