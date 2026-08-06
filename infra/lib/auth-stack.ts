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

  /**
   * 外形監視のカナリア専用クライアント。
   * ブラウザ向けクライアントを SRP のみに保つため、管理者パスワード認証は
   * こちらに分ける（同じクライアントに両方を持たせると、IAM の足がかりを得た
   * 相手が任意の利用者になりすませる余地が広がる）
   */
  public readonly canaryUserPoolClient: cognito.UserPoolClient;

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
      // ブラウザからの認証は SRP のみ（パスワードを送らせない）
      authFlows: {
        userSrp: true,
      },
      // 存在しない利用者への応答を、誤ったパスワードのときと揃える。
      // サインイン画面は総当たりに晒されるため、登録済みメールアドレスの
      // 割り出しに使えないようにする。
      //
      // 画面の分岐に使っている例外は変わらないことを実機で確認済み
      // （未確認利用者は UserNotConfirmedException、サインアップ済みは
      // UsernameExistsException、確認コード誤りは CodeMismatchException のまま）。
      // 変わるのは存在しない利用者の UserNotFoundException → NotAuthorizedException だけで、
      // これは「メールアドレスまたはパスワードが正しくありません」に流れて表示も適切になる
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // 監視カナリア専用。SRP は持たせず、IAM 認証済みの呼び出し元からしか
    // 使えない管理者パスワード認証だけを許可する
    this.canaryUserPoolClient = this.userPool.addClient('CanaryUserPoolClient', {
      userPoolClientName: `${props.envName}-sakekasu-canary-client`,
      authFlows: {
        adminUserPassword: true,
      },
      // 存在しない利用者と誤ったパスワードを同じ応答にし、
      // 登録済みメールアドレスの割り出しに使えないようにする
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(1),
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

    new cdk.CfnOutput(this, 'CanaryUserPoolClientId', {
      value: this.canaryUserPoolClient.userPoolClientId,
      description:
        '監視カナリア用クライアント ID（sommelier/agentcore/agentcore.json の allowedClients に追加する）',
    });

    new cdk.CfnOutput(this, 'AuthRegion', {
      value: this.region,
      description: '認証リソースの AWS リージョン',
    });
  }
}
