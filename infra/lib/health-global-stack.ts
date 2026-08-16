import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import { applyRoleBoundary } from './role-boundary.js';

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

    // このスタックが作るロールはすべて Permissions Boundary の内側に置く
    // （Issue #150）。cdkd のデプロイロールは境界の付いたロールしか
    // 作り替えられない条件になっているため、外すとデプロイが止まる。
    // 詳細は lib/role-boundary.ts
    applyRoleBoundary(this);

    const prefix = `${props.envName}-sakekasu`;
    const targetBusArn = `arn:aws:events:${props.targetRegion}:${this.account}:event-bus/default`;

    const ruleName = `${prefix}-aws-health-global`;
    const ruleArn = `arn:aws:events:${this.region}:${this.account}:rule/${ruleName}`;

    // 転送のために、EventBridge 自身に相手側バスへの書き込みを許可する。
    //
    // 引き受けられる相手を「このルール」に限定する。条件を付けないと、
    // 同じアカウントで別のルールを作れる相手がこのロールを指定して、
    // 監視用のイベントバスへ好きなイベントを流し込めてしまう
    const forwarderRole = new iam.Role(this, 'HealthForwarderRole', {
      roleName: `${prefix}-health-forwarder`,
      assumedBy: new iam.ServicePrincipal('events.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': this.account },
          ArnEquals: { 'aws:SourceArn': ruleArn },
        },
      }),
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
      ruleName,
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
