import { describe, it, beforeAll } from 'vitest';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { DevOpsAgentStack } from '../lib/devops-agent-stack.js';

// Agent Space を置く運用ツール専用アカウント（ops-tooling）
const MONITORING_ACCOUNT_ID = '444455556666';
const AGENT_SPACE_ARN = `arn:aws:aidevops:ap-northeast-1:${MONITORING_ACCOUNT_ID}:agentspace/abc123`;

function synth(): Template {
  const app = new cdk.App();
  const stack = new DevOpsAgentStack(app, 'TestDevOpsAgent', {
    envName: 'dev',
    monitoringAccountId: MONITORING_ACCOUNT_ID,
    agentSpaceArn: AGENT_SPACE_ARN,
    env: { account: '111111111111', region: 'ap-northeast-1' },
  });
  return Template.fromStack(stack);
}

describe('DevOpsAgentStack', () => {
  let template: Template;

  beforeAll(() => {
    template = synth();
  });

  it('DevOps Agent のサービスプリンシパルだけが引き受けられる調査用ロールを作る', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'sakekasu-dev-devops-agent-monitoring',
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: 'sts:AssumeRole',
            Principal: { Service: 'aidevops.amazonaws.com' },
          }),
        ]),
      },
    });
  });

  it('信頼条件でプライマリアカウントと Agent Space を絞る（混乱した代理人の防止）', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'sakekasu-dev-devops-agent-monitoring',
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: {
              StringEquals: { 'aws:SourceAccount': MONITORING_ACCOUNT_ID },
              // ワイルドカードを解釈する ArnLike ではなく完全一致で受ける
              ArnEquals: { 'aws:SourceArn': AGENT_SPACE_ARN },
            },
          }),
        ]),
      },
    });
  });

  it('調査用ロールには読み取り専用の管理ポリシーだけを付ける（実行系は持たせない）', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'sakekasu-dev-devops-agent-monitoring',
      ManagedPolicyArns: [
        {
          'Fn::Join': Match.arrayWith([
            Match.arrayWith([':iam::aws:policy/AIDevOpsAgentAccessPolicy']),
          ]),
        },
      ],
    });
  });

  it('Resource Explorer のサービスリンクロールだけ作成を許可する', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'AllowCreateServiceLinkedRoles',
            Action: 'iam:CreateServiceLinkedRole',
            Resource:
              'arn:aws:iam::111111111111:role/aws-service-role/' +
              'resource-explorer-2.amazonaws.com/AWSServiceRoleForResourceExplorer',
          }),
        ]),
      },
    });
  });

  it('転送 Lambda は持たない（共通基盤の共通トピックへ移した）', () => {
    template.resourceCountIs('AWS::Lambda::Function', 0);
    template.resourceCountIs('AWS::SNS::Subscription', 0);
    template.resourceCountIs('AWS::CloudWatch::Alarm', 0);
  });
});
