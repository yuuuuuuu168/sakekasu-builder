import { describe, it, expect, beforeAll } from 'vitest';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { BillingNotifierStack } from '../lib/billing-notifier-stack.js';

const TARGET_ACCOUNTS = [
  { id: '111111111111', label: '親アカウント（管理）' },
  { id: '222222222222', label: 'sakekasu-builder（アプリ本体）' },
];

function synth(): Template {
  const app = new cdk.App();
  const stack = new BillingNotifierStack(app, 'TestBillingNotifier', {
    targetAccounts: TARGET_ACCOUNTS,
    env: { account: '111111111111', region: 'ap-northeast-1' },
  });
  return Template.fromStack(stack);
}

describe('BillingNotifierStack', () => {
  let template: Template;

  beforeAll(() => {
    template = synth();
  });

  it('レポート Lambda があり、対象アカウントと Webhook のパラメータ名だけを持つ', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'sakekasu-billing-notifier',
      Environment: {
        Variables: {
          WEBHOOK_PARAMETER_NAME: '/sakekasu-billing/slack-webhook-url',
          TARGET_ACCOUNTS: JSON.stringify(TARGET_ACCOUNTS),
        },
      },
    });
  });

  it('毎日 00:05 UTC（09:05 JST）に実行される', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Name: 'sakekasu-billing-daily-schedule',
      ScheduleExpression: 'cron(5 0 * * ? *)',
    });
  });

  it('Cost Explorer の読み取り権限を持つ', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ce:GetCostAndUsage',
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });

  it('Webhook URL はコードに持たず SSM パラメータを名前で参照する', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ssm:GetParameter',
            Resource:
              'arn:aws:ssm:ap-northeast-1:111111111111:parameter/sakekasu-billing/slack-webhook-url',
          }),
        ]),
      },
    });
  });

  it('アラート用の SNS トピックを Slack 通知 Lambda が購読している', () => {
    template.hasResourceProperties('AWS::SNS::Topic', {
      TopicName: 'sakekasu-billing-alerts',
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'sakekasu-billing-slack-notifier',
    });
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'lambda',
    });
  });

  it('レポートの失敗・沈黙と Slack 通知の失敗を監視する3アラームがある', () => {
    template.resourceCountIs('AWS::CloudWatch::Alarm', 3);
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'sakekasu-billing-notifier-failure',
    });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'sakekasu-billing-slack-notifier-failure',
    });
    // 「そもそも動いていない」は欠損を異常として検知する
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'sakekasu-billing-notifier-silent',
      ComparisonOperator: 'LessThanThreshold',
      TreatMissingData: 'breaching',
      Period: 86400,
    });
  });

  it('アラームは発報と復旧の両方を通知する', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    for (const [logicalId, alarm] of Object.entries(alarms)) {
      const properties = (alarm as { Properties: { AlarmActions?: unknown[]; OKActions?: unknown[] } })
        .Properties;
      expect(properties.AlarmActions?.length, `${logicalId} の AlarmActions`).toBe(1);
      expect(properties.OKActions?.length, `${logicalId} の OKActions`).toBe(1);
    }
  });
});
