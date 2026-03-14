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
