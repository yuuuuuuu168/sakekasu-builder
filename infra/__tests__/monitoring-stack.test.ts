import { Template, Match } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack.js';
import { ApiStack } from '../lib/api-stack.js';
import { MonitoringStack } from '../lib/monitoring-stack.js';

const RUNTIME_ARN =
  'arn:aws:bedrock-agentcore:ap-northeast-1:111122223333:runtime/sommelier_test-ABC123';

/** Fn::Join の静的な文字列部分だけを繋ぐ（トークンは無視する） */
function flattenJoin(value: unknown): string {
  if (typeof value === 'string') return value;
  const join = (value as { 'Fn::Join'?: [string, unknown[]] })?.['Fn::Join'];
  if (!join) return JSON.stringify(value);
  const [separator, parts] = join;
  return parts.map((part) => (typeof part === 'string' ? part : '')).join(separator);
}

function synth() {
  const app = new cdk.App();
  const env = { account: '111122223333', region: 'ap-northeast-1' };

  const authStack = new AuthStack(app, 'TestAuth', { envName: 'dev', env });
  const apiStack = new ApiStack(app, 'TestApi', {
    envName: 'dev',
    userPool: authStack.userPool,
    env,
  });
  const monitoringStack = new MonitoringStack(app, 'TestMonitoring', {
    envName: 'dev',
    graphqlApi: apiStack.graphqlApi,
    tables: [apiStack.purchaseTable, apiStack.drinkingTable],
    functions: [apiStack.presignedUrlFunction, apiStack.ocrAnalyzerFunction],
    ocrFunction: apiStack.ocrAnalyzerFunction,
    imageDeleteFailMetricFilter: apiStack.imageDeleteFailMetricFilter,
    sommelierRuntimeArn: RUNTIME_ARN,
    siteUrl: 'https://example.com',
    userPoolId: 'ap-northeast-1_TEST',
    userPoolClientId: 'testclientid',
    env,
  });

  return {
    template: Template.fromStack(monitoringStack),
    authTemplate: Template.fromStack(authStack),
  };
}

describe('MonitoringStack', () => {
  let template: Template;
  let authTemplate: Template;

  beforeAll(() => {
    const result = synth();
    template = result.template;
    authTemplate = result.authTemplate;
  });

  it('アラートを流す SNS トピックがある', () => {
    template.hasResourceProperties('AWS::SNS::Topic', {
      TopicName: 'dev-sakekasu-alerts',
    });
  });

  it('Slack 通知 Lambda がトピックを購読している', () => {
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'lambda',
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'dev-sakekasu-slack-notifier',
    });
  });

  it('Webhook URL はコードに持たず SSM パラメータ名だけを渡す', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'dev-sakekasu-slack-notifier',
      Environment: {
        Variables: {
          WEBHOOK_PARAMETER_NAME: '/dev-sakekasu/monitoring/slack-webhook-url',
        },
      },
    });
  });

  it('Slack 通知 Lambda の SSM 参照は該当パラメータだけに絞る', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ssm:GetParameter',
            Resource:
              'arn:aws:ssm:ap-northeast-1:111122223333:parameter/dev-sakekasu/monitoring/slack-webhook-url',
          }),
        ]),
      },
    });
  });

  // 今回の障害を検知できる本命のアラーム
  it('ソムリエの認証拒否を例外の種類ごとに監視する', () => {
    for (const exceptionType of [
      'UnauthorizedInboundTokenException',
      'InvalidInboundTokenException',
    ]) {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: `dev-sakekasu-sommelier-auth-failure-${exceptionType}`,
        Namespace: 'AWS/Bedrock-AgentCore',
        MetricName: 'InboundAuthorizationFailure',
        Dimensions: Match.arrayWith([
          { Name: 'ExceptionType', Value: exceptionType },
          { Name: 'ResourceId', Value: RUNTIME_ARN },
        ]),
      });
    }
  });

  it('AI 機能（ソムリエ・OCR）のエラーとスロットルを監視する', () => {
    for (const alarmName of [
      'dev-sakekasu-sommelier-system-errors',
      'dev-sakekasu-sommelier-throttles',
      'dev-sakekasu-ocr-errors',
      'dev-sakekasu-ocr-throttles',
    ]) {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', { AlarmName: alarmName });
    }
  });

  it('サービス正常性（AppSync・DynamoDB）を監視する', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'dev-sakekasu-appsync-5xx',
      Namespace: 'AWS/AppSync',
      MetricName: '5XXError',
    });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/DynamoDB',
      MetricName: 'ThrottledRequests',
    });
  });

  // 通知経路そのものが壊れると誰も気づけない
  it('Slack 通知 Lambda の失敗も監視する', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'dev-sakekasu-slack-notifier-failure',
    });
  });

  // 以前は ApiStack にあり通知先が無かった
  it('画像削除失敗アラームを引き継ぎ、通知先を持たせる', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'dev-sakekasu-image-delete-fail',
      MetricName: 'ImageDeleteFailCount',
    });
  });

  it('すべてのアラームが発報と復旧の両方を通知する', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    expect(Object.keys(alarms).length).toBeGreaterThan(0);

    for (const [logicalId, alarm] of Object.entries(alarms)) {
      expect(alarm.Properties.AlarmActions, `${logicalId} に発報通知が無い`).toBeDefined();
      expect(alarm.Properties.OKActions, `${logicalId} に復旧通知が無い`).toBeDefined();
    }
  });

  it('データ欠損では発報しない（利用が無い時間帯に鳴らさない）', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    for (const [logicalId, alarm] of Object.entries(alarms)) {
      expect(alarm.Properties.TreatMissingData, `${logicalId} の欠損時の扱いが違う`).toBe(
        'notBreaching',
      );
    }
  });

  it('外形監視を5分ごとに回す', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Name: 'dev-sakekasu-health-check-schedule',
      ScheduleExpression: 'rate(5 minutes)',
    });
  });

  it('外形監視は認証なしで叩いて拒否が返ることを正常とみなす', () => {
    const functions = template.findResources('AWS::Lambda::Function');
    const healthCheck = Object.values(functions).find(
      (fn) => fn.Properties?.FunctionName === 'dev-sakekasu-health-check',
    );
    expect(healthCheck).toBeDefined();

    // AppSync の URL がデプロイ時解決のトークンのため、値は Fn::Join になる。
    // 静的な部分だけ繋いで中身を確かめる
    const targets = flattenJoin(
      healthCheck!.Properties.Environment.Variables.HEALTH_CHECK_TARGETS,
    );

    expect(targets).toContain('"name":"frontend"');
    expect(targets).toContain('"expectStatus":[200]');
    // 認証なしで叩き、拒否されることを正常とみなす
    expect(targets).toContain('"name":"sommelier-runtime"');
    expect(targets).toContain('"expectStatus":[401,403]');
    expect(targets).toContain('"name":"appsync"');
  });

  it('外形監視は2回続けて失敗したときだけ通知する', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'dev-sakekasu-health-check-frontend',
      EvaluationPeriods: 2,
    });
  });

  it('ソムリエのカナリアは費用を抑えるため6時間ごとに回す', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Name: 'dev-sakekasu-sommelier-canary-schedule',
      ScheduleExpression: 'rate(6 hours)',
    });
  });

  it('カナリアの認証情報は Secrets Manager 名だけを渡す', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'dev-sakekasu-sommelier-canary',
      Environment: {
        Variables: Match.objectLike({
          CREDENTIALS_SECRET_ID: 'dev-sakekasu/monitoring/canary-user',
        }),
      },
    });
  });

  it('カナリアの Cognito 権限は対象ユーザープールだけに絞る', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'cognito-idp:AdminInitiateAuth',
            Resource:
              'arn:aws:cognito-idp:ap-northeast-1:111122223333:userpool/ap-northeast-1_TEST',
          }),
        ]),
      },
    });
  });

  it('メトリクス書き込みは自分の名前空間だけに限定する', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'cloudwatch:PutMetricData',
            Condition: { StringEquals: { 'cloudwatch:namespace': 'dev-sakekasu-monitoring' } },
          }),
        ]),
      },
    });
  });

  // カナリアがサインインするために必要
  it('UserPoolClient が管理者パスワード認証を許可している', () => {
    authTemplate.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ExplicitAuthFlows: Match.arrayWith(['ALLOW_ADMIN_USER_PASSWORD_AUTH']),
    });
  });
});
