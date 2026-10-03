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

  // Issue #70: MFA は任意加入の TOTP のみ
  describe('MFA', () => {
    it('UserPool が MFA を任意加入にしている（必須だと既存利用者とカナリアが締め出される）', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        MfaConfiguration: 'OPTIONAL',
      });
    });

    it('第二要素は TOTP のみ（SMS は電話番号未収集のため使わない）', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        EnabledMfas: ['SOFTWARE_TOKEN_MFA'],
      });
    });

    /**
     * SMS の MFA は使わないが、文面は空にしない。
     *
     * cdkd は provider.update に state の全体像を渡し、state に無い任意
     * プロパティを「省略」ではなく「空文字」として送る。Cognito は
     * smsAuthenticationMessage の空文字を長さと {####} の両方で拒否するので、
     * この1件が欠けると UserPool へのあらゆる更新が落ちる。
     *
     * 2026-10-03、文字化けの修復（cdkd drift --revert）が実際にここで落ちた。
     * cdkd 側が直るまでは外せない。
     */
    it('SmsAuthenticationMessage が Cognito の制約を満たす', () => {
      const pools = template.findResources('AWS::Cognito::UserPool');
      const values = Object.values(pools).map(
        (r) => (r as { Properties: { SmsAuthenticationMessage?: unknown } }).Properties
          .SmsAuthenticationMessage,
      );

      expect(values.length, 'UserPool が見つからない').toBeGreaterThan(0);
      for (const value of values) {
        expect(
          typeof value,
          'SmsAuthenticationMessage が無い。cdkd が空文字を送って UserPool の更新が落ちる',
        ).toBe('string');
        // Cognito の制約そのまま: 6文字以上で {####} を含む
        expect(String(value).length, '6文字未満だと Cognito が拒否する').toBeGreaterThanOrEqual(6);
        expect(String(value), '{####} が無いと Cognito が拒否する').toContain('{####}');
      }
    });

    it('SMS の MFA そのものは有効にしていない', () => {
      // 上の文面は cdkd の回避でしかない。SmsConfiguration を置いたり
      // EnabledMfas に SMS_MFA を混ぜたりはしない
      const pools = template.findResources('AWS::Cognito::UserPool');
      for (const pool of Object.values(pools)) {
        const props = (pool as {
          Properties: { SmsConfiguration?: unknown; EnabledMfas?: unknown[] };
        }).Properties;

        expect(props.SmsConfiguration, 'SmsConfiguration が付いている').toBeUndefined();
        expect(props.EnabledMfas, 'EnabledMfas に SMS が混ざっている').not.toContain('SMS_MFA');
      }
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
