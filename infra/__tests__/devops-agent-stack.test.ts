import { describe, it, beforeAll } from 'vitest';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import { DevOpsAgentStack } from '../lib/devops-agent-stack.js';

// Agent Space を置く運用ツール専用アカウント（ops-tooling）
const MONITORING_ACCOUNT_ID = '444455556666';
const AGENT_SPACE_ARN = `arn:aws:aidevops:ap-northeast-1:${MONITORING_ACCOUNT_ID}:agentspace/abc123`;

function synth(): Template {
  const app = new cdk.App();
  // トピックは監視スタックが持つものを想定しているため、別スタックから渡す
  const topicStack = new cdk.Stack(app, 'TestTopicStack', {
    env: { account: '232791540685', region: 'ap-northeast-1' },
  });
  const alertTopic = new sns.Topic(topicStack, 'AlertTopic', { topicName: 'dev-sakekasu-alerts' });

  const stack = new DevOpsAgentStack(app, 'TestDevOpsAgent', {
    envName: 'dev',
    monitoringAccountId: MONITORING_ACCOUNT_ID,
    agentSpaceArn: AGENT_SPACE_ARN,
    alertTopic,
    env: { account: '232791540685', region: 'ap-northeast-1' },
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

  it('転送 Lambda の同時実行数を絞る（一斉発報で調査が同時に立ち上がるのを避ける）', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'dev-sakekasu-devops-agent-webhook',
      ReservedConcurrentExecutions: 2,
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
              'arn:aws:iam::232791540685:role/aws-service-role/' +
              'resource-explorer-2.amazonaws.com/AWSServiceRoleForResourceExplorer',
          }),
        ]),
      },
    });
  });

  it('転送 Lambda は自分の失敗アラーム名を知っていて、秘密は名前で参照する', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'dev-sakekasu-devops-agent-webhook',
      Environment: {
        Variables: {
          WEBHOOK_SECRET_ID: 'dev-sakekasu/devops-agent/webhook',
          ENV_NAME: 'dev',
          SELF_ALARM_NAME: 'dev-sakekasu-devops-agent-webhook-failure',
          SERVICE_NAME: 'sakekasu-builder',
        },
      },
    });

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'secretsmanager:GetSecretValue',
            Resource:
              'arn:aws:secretsmanager:ap-northeast-1:232791540685:secret:dev-sakekasu/devops-agent/webhook-*',
          }),
        ]),
      },
    });
  });

  it('既存のアラートトピックを転送 Lambda が購読する', () => {
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'lambda',
    });
  });

  it('転送の失敗を監視するアラームがあり、発報も復旧も同じトピックへ流す', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'dev-sakekasu-devops-agent-webhook-failure',
      Threshold: 1,
      AlarmActions: Match.anyValue(),
      OKActions: Match.anyValue(),
    });
  });
});
