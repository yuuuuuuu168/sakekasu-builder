import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import { applyRoleBoundary } from './role-boundary.js';
import { appNamePrefix, iamRoleArn } from './resource-names.js';

export interface DevOpsAgentStackProps extends cdk.StackProps {
  /** 環境名（dev, staging, prod） */
  envName: string;
  /** Agent Space を置いたプライマリアカウントの ID */
  monitoringAccountId: string;
  /** 信頼する Agent Space の ARN。1つのスペースだけに絞る */
  agentSpaceArn: string;
}

/**
 * AWS DevOps Agent 連携のスタック（Issue #67）。
 *
 * Agent Space 自体は運用ツール用のアカウント（ops-tooling）の
 * コンソールで作る。
 * このスタックが持つのは、**アプリ本体のアカウント側に必要なもの**のうち
 * **調査用のクロスアカウントロール**だけ。DevOps Agent のサービスプリンシパルが
 * 直接引き受ける読み取り専用ロールで、信頼条件を Agent Space の ARN に絞って
 * 混乱した代理人（confused deputy）を防ぐ。
 *
 * アラームを DevOps Agent の Webhook に投げる転送 Lambda は、以前はここにあって
 * builder のトピック（dev-sakekasu-alerts）だけを購読していた。4 アプリのアラームを
 * まとめて調査に回すため、共通基盤（sakekasu-integrated_environment）の共通トピックへ移した
 * （docs/devops-agent.md）。builder のアラームも共通トピックへ送る（monitoring-stack.ts）。
 *
 * ロールは共通基盤ではなくこのスタックに置く。共通基盤のロールの境界の中では、
 * このロールが要る権限（AIDevOpsAgentAccessPolicy）を持たせられないため。
 *
 * Agent Space の ARN が決まって初めて意味を持つため、コンテキストに
 * `agentSpaceArn` が入っているときだけ合成される（README の手順を参照）。
 */
export class DevOpsAgentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DevOpsAgentStackProps) {
    super(scope, id, props);

    // このスタックが作るロールはすべて Permissions Boundary の内側に置く
    // （Issue #150）。cdkd のデプロイロールは境界の付いたロールしか
    // 作り替えられない条件になっているため、外すとデプロイが止まる。
    // 詳細は lib/role-boundary.ts
    applyRoleBoundary(this);

    // --- 調査用のクロスアカウントロール（読み取り専用） ---

    // アクション実行用（Operator）は作らない。まず調査だけを任せ、
    // 実行が必要になった時点で最小権限で足す（Issue #67 の方針）
    // 名前が `sakekasu-` で始まらないと cdkd のデプロイロールが作れない。
    // cdkd-policies.ts の iam:CreateRole は `role/sakekasu-*` に絞ってある。
    // 他のリソースと違って `${prefix}-`（= dev-sakekasu-）を使えないのはこのため。
    // スタック名が `sakekasu-dev-devops-agent` なので、そちらに揃う形でもある
    const monitoringRole = new iam.Role(this, 'MonitoringRole', {
      roleName: `${appNamePrefix(props.envName)}-devops-agent-monitoring`,
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
          iamRoleArn(
            this.account,
            'aws-service-role/resource-explorer-2.amazonaws.com/AWSServiceRoleForResourceExplorer',
          ),
        ],
      }),
    );

    new cdk.CfnOutput(this, 'MonitoringRoleArn', {
      value: monitoringRole.roleArn,
      description: 'DevOps Agent のコンソールでセカンダリソースに登録するロール ARN',
    });
  }
}
