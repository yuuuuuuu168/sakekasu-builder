import { Template, Match } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { HealthGlobalStack } from '../lib/health-global-stack.js';

const TARGET_BUS = 'arn:aws:events:ap-northeast-1:111122223333:event-bus/default';

describe('HealthGlobalStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new HealthGlobalStack(app, 'TestHealthGlobal', {
      envName: 'dev',
      targetRegion: 'ap-northeast-1',
      env: { account: '111122223333', region: 'us-east-1' },
    });
    template = Template.fromStack(stack);
  });

  // IAM や CloudFront のイベントは us-east-1 にしか届かない
  it('グローバルの Health イベントを拾うルールがある', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Name: 'dev-sakekasu-aws-health-global',
      EventPattern: {
        source: ['aws.health'],
        detail: { eventTypeCategory: ['issue', 'scheduledChange'] },
      },
      State: 'ENABLED',
    });
  });

  // EventBridge のターゲットは同一リージョンに限られるため、
  // 監視リージョンへは「イベントバスへの転送」で渡す
  it('監視リージョンのイベントバスへ転送する', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Targets: Match.arrayWith([Match.objectLike({ Arn: TARGET_BUS })]),
    });
  });

  it('転送に使うロールの権限が宛先バスだけに絞られている', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'events:PutEvents',
            Resource: TARGET_BUS,
          }),
        ]),
      },
    });
  });

  it('ロールを引き受けられるのは EventBridge だけ', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: { Service: 'events.amazonaws.com' },
            Action: 'sts:AssumeRole',
          }),
        ]),
      },
    });
  });

  // IAM の description は ASCII / Latin-1 しか受け付けず、
  // 日本語を入れるとデプロイ時に CREATE_FAILED になる（実際に踏んだ）
  it('IAM ロールの説明に ASCII 以外を混ぜない', () => {
    const roles = template.findResources('AWS::IAM::Role');
    for (const [logicalId, role] of Object.entries(roles)) {
      const description = role.Properties?.Description as string | undefined;
      if (!description) continue;
      expect(
        /^[\t\n\r\x20-\x7E\xA1-\xFF]*$/.test(description),
        `${logicalId} の説明に IAM が受け付けない文字がある: ${description}`,
      ).toBe(true);
    }
  });

  // 転送だけが役目なので、余計なものを作らない
  it('作るのはルールとロールだけ', () => {
    template.resourceCountIs('AWS::Events::Rule', 1);
    template.resourceCountIs('AWS::SNS::Topic', 0);
    template.resourceCountIs('AWS::Lambda::Function', 0);
  });
});
