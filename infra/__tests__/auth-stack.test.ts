import { Template, Match } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack.js';

describe('AuthStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new AuthStack(app, 'TestAuthStack', {
      envName: 'dev',
    });
    template = Template.fromStack(stack);
  });

  // Requirements 2.1: メールアドレスをサインイン識別子とする
  it('UserPool がメールアドレスをサインイン識別子として設定している', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UsernameAttributes: ['email'],
    });
  });

  // Requirements 2.2: セルフサインアップを有効化
  it('UserPool がセルフサインアップを有効化している', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: {
        AllowAdminCreateUserOnly: false,
      },
    });
  });

  // Requirements 2.2: メールアドレスによる自動検証
  it('UserPool がメールアドレスの自動検証を設定している', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AutoVerifiedAttributes: ['email'],
    });
  });

  // Requirements 2.3: パスワードポリシー
  it('UserPool が正しいパスワードポリシーを設定している', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      Policies: {
        PasswordPolicy: {
          MinimumLength: 8,
          RequireUppercase: true,
          RequireLowercase: true,
          RequireNumbers: true,
          RequireSymbols: true,
        },
      },
    });
  });

  // Requirements 2.4: UserPool Client が SRP 認証フローを有効化している
  it('UserPoolClient が SRP 認証フローを有効化している', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ExplicitAuthFlows: Match.arrayWith([
        'ALLOW_USER_SRP_AUTH',
      ]),
    });
  });

  // サインイン画面から登録済みメールアドレスを割り出せないようにする
  it('すべてのクライアントが利用者の存在を隠す', () => {
    const clients = template.findResources('AWS::Cognito::UserPoolClient');
    expect(Object.keys(clients).length).toBeGreaterThan(0);

    for (const [logicalId, client] of Object.entries(clients)) {
      expect(
        client.Properties.PreventUserExistenceErrors,
        `${logicalId} が利用者の存在を隠していない`,
      ).toBe('ENABLED');
    }
  });

  // Requirements 2.5: トークン有効期限
  it('UserPoolClient がアクセストークン有効期限を60分に設定している', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      AccessTokenValidity: 60,
      TokenValidityUnits: Match.objectLike({
        AccessToken: 'minutes',
      }),
    });
  });

  it('UserPoolClient がリフレッシュトークン有効期限を30日に設定している', () => {
    // CDK は Duration.days(30) を分単位（43200）で出力する
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      RefreshTokenValidity: 43200,
      TokenValidityUnits: Match.objectLike({
        RefreshToken: 'minutes',
      }),
    });
  });

  // Issue #66: 新規ユーザー登録の Slack 通知
  describe('新規登録の通知', () => {
    /** Fn::Join の静的な文字列部分だけを繋ぐ（トークンは無視する） */
    function flattenJoin(value: unknown): string {
      if (typeof value === 'string') return value;
      const join = (value as { 'Fn::Join'?: [string, unknown[]] })?.['Fn::Join'];
      if (!join) return JSON.stringify(value);
      const [separator, parts] = join;
      return parts.map((part) => (typeof part === 'string' ? part : '')).join(separator);
    }

    it('サインアップ確認後に通知 Lambda が呼ばれる', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        LambdaConfig: {
          PostConfirmation: Match.anyValue(),
        },
      });
    });

    it('通知 Lambda はアラートトピックの ARN を名前規約で受け取る', () => {
      const functions = template.findResources('AWS::Lambda::Function', {
        Properties: { FunctionName: 'dev-sakekasu-signup-notifier' },
      });
      expect(Object.keys(functions)).toHaveLength(1);

      const variables = Object.values(functions)[0].Properties.Environment.Variables;
      expect(variables.ENV_NAME).toBe('dev');
      expect(flattenJoin(variables.TOPIC_ARN)).toContain(':dev-sakekasu-alerts');
    });

    it('通知 Lambda の SNS 送信先はアラートトピックだけに絞る', () => {
      const policies = template.findResources('AWS::IAM::Policy');
      const statements = Object.values(policies).flatMap(
        (policy) => policy.Properties.PolicyDocument.Statement as unknown[],
      );
      const publish = statements.find(
        (statement) => (statement as { Action?: string }).Action === 'sns:Publish',
      ) as { Resource: unknown } | undefined;

      expect(publish).toBeDefined();
      expect(flattenJoin(publish!.Resource)).toContain(':dev-sakekasu-alerts');
    });

    it('通知の失敗をメトリクスに起こしている（アラームは監視スタック側）', () => {
      template.hasResourceProperties('AWS::Logs::MetricFilter', {
        FilterPattern: '{ $.level = "ERROR" && $.action = "notifySignup" }',
        MetricTransformations: [
          Match.objectLike({
            MetricNamespace: 'dev-sakekasu',
            MetricName: 'SignupNotifyFailCount',
          }),
        ],
      });
    });
  });

  // Requirements 2.7: CloudFormation 出力
  it('UserPoolId の CfnOutput が存在する', () => {
    template.hasOutput('UserPoolId', {});
  });

  it('UserPoolClientId の CfnOutput が存在する', () => {
    template.hasOutput('UserPoolClientId', {});
  });

  it('AuthRegion の CfnOutput が存在する', () => {
    template.hasOutput('AuthRegion', {});
  });
});
