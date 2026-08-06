import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

export interface HealthGlobalStackProps extends cdk.StackProps {
  /** 環境名（dev, staging, prod） */
  envName: string;
  /** 転送先（監視スタックがあるリージョン） */
  targetRegion: string;
}

/**
 * グローバルサービスの AWS Health イベントを拾うためのスタック。**us-east-1 に置く。**
 *
 * IAM や CloudFront のようにリージョンを持たないサービスのイベントは
 * us-east-1 にしか配信されない。一方 EventBridge のターゲットは同一リージョンに
 * 限られるため、ここでは「監視スタック側のイベントバスへ転送する」ことだけを行う。
 * 転送先のルールが受け取って Slack まで運ぶ。
 */
export class HealthGlobalStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: HealthGlobalStackProps) {
    super(scope, id, props);

    const prefix = `${props.envName}-sakekasu`;
    const targetBusArn = `arn:aws:events:${props.targetRegion}:${this.account}:event-bus/default`;

    // 転送のために、EventBridge 自身に相手側バスへの書き込みを許可する
    const forwarderRole = new iam.Role(this, 'HealthForwarderRole', {
      roleName: `${prefix}-health-forwarder`,
      assumedBy: new iam.ServicePrincipal('events.amazonaws.com'),
      // IAM の description は ASCII / Latin-1 しか受け付けないため英語で書く
      // （日本語を入れると CREATE_FAILED になる）
      description: 'Forwards global AWS Health events to the monitoring region',
    });
    forwarderRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [targetBusArn],
      }),
    );

    new events.Rule(this, 'AwsHealthGlobalRule', {
      ruleName: `${prefix}-aws-health-global`,
      description: 'グローバルサービスの AWS Health イベントを監視リージョンへ転送する',
      eventPattern: {
        source: ['aws.health'],
        // 絞り込みは転送先のルールと揃える
        detail: {
          eventTypeCategory: ['issue', 'scheduledChange'],
        },
      },
      targets: [
        new targets.EventBus(events.EventBus.fromEventBusArn(this, 'TargetBus', targetBusArn), {
          role: forwarderRole,
        }),
      ],
    });

    new cdk.CfnOutput(this, 'ForwardsTo', {
      value: targetBusArn,
      description: 'グローバルの Health イベントの転送先イベントバス',
    });
  }
}
