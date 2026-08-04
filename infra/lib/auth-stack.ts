import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';

export interface AuthStackProps extends cdk.StackProps {
  /** 環境名（dev, staging, prod） */
  envName: string;
}

export class AuthStack extends cdk.Stack {
  /** UserPool を公開し、ApiStack から参照可能にする */
  public readonly userPool: cognito.UserPool;

  /** UserPool Client を公開し、フロントエンド設定生成で使用する */
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${props.envName}-sakekasu-userpool`,
      signInAliases: {
        email: true,
      },
      selfSignUpEnabled: true,
      autoVerify: {
        email: true,
      },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      userVerification: {
        emailSubject: 'sakekasu-builder 確認コード',
        emailBody: 'あなたの確認コードは {####} です。',
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
    });

    this.userPoolClient = this.userPool.addClient('UserPoolClient', {
      userPoolClientName: `${props.envName}-sakekasu-client`,
      authFlows: {
        userSrp: true,
        // 外形監視の カナリアが監視用ユーザーでサインインするために使う。
        // このフローは IAM 認証済みの呼び出し元（= 監視 Lambda のロール）からしか
        // 使えず、ブラウザからは利用できない
        adminUserPassword: true,
      },
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // CloudFormation 出力
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito ユーザープール ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito ユーザープールクライアント ID',
    });

    new cdk.CfnOutput(this, 'AuthRegion', {
      value: this.region,
      description: '認証リソースの AWS リージョン',
    });
  }
}
