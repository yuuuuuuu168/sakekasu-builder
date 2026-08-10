import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as path from 'node:path';
import * as url from 'node:url';
import type { Construct } from 'constructs';

const here = path.dirname(url.fileURLToPath(import.meta.url));

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

  /**
   * 新規登録の Slack 通知に失敗したときのメトリクスフィルター。
   * アラームは監視スタックで作る（通知先と一緒に管理するため）
   */
  public readonly signupNotifyFailMetricFilter: logs.MetricFilter;

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
      // MFA は任意加入（Issue #70）。必須にすると既存利用者と監視カナリアが
      // 次回サインインで MFA 登録を強制されて締め出されるため、OPTIONAL に留める。
      // SMS は電話番号を収集しておらず、SIM スワップ耐性でも TOTP に劣るので使わない
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: false,
        otp: true,
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
      // 丸められるのは利用者の存在が漏れる応答：
      // ・存在しない利用者: UserNotFoundException → NotAuthorizedException
      // ・管理者リセット中（RESET_REQUIRED）: PasswordResetRequiredException → NotAuthorizedException
      //   （SignInForm の PasswordResetRequiredException 分岐は本設定が外れたときの保険）
      // ・ForgotPassword: 存在しない利用者にも疑似的な CodeDeliveryDetails を返す
      // サインインはどれも「メールアドレスまたはパスワードが正しくありません」に流れ、
      // パスワード再設定はコード送信済みと同じ表示になる。
      // https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pool-managing-errors.html
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

    // --- 新規ユーザー登録の Slack 通知（Issue #66）---

    // 通知先は監視スタックのアラートトピック。オブジェクト参照で受け取ると
    // 監視スタック（当スタックに依存済み）との循環参照になるため、
    // 名前の規約から ARN を組み立てる。監視スタックが未デプロイでも
    // サインアップは壊れない（通知だけ失敗し、ログに残る）
    const alertTopicArn = `arn:aws:sns:${this.region}:${this.account}:${props.envName}-sakekasu-alerts`;

    const signupNotifier = new NodejsFunction(this, 'SignupNotifierFunction', {
      functionName: `${props.envName}-sakekasu-signup-notifier`,
      runtime: Runtime.NODEJS_22_X,
      entry: path.join(here, '../lambda/signup-notifier/index.ts'),
      handler: 'handler',
      // Cognito はトリガーの完了を 5 秒しか待たない。Lambda 側だけ長くしても
      // 先に Cognito が諦めてサインアップの確認がエラーになるため、揃えておく
      timeout: cdk.Duration.seconds(5),
      // Cognito の 5 秒にはコールドスタートも含まれるため、既定の 128MB より
      // CPU を増やして初回起動を短くする（費用は呼び出し頻度が低いので誤差）
      memorySize: 256,
      environment: {
        TOPIC_ARN: alertTopicArn,
        ENV_NAME: props.envName,
      },
      bundling: {
        format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
        mainFields: ['module', 'main'],
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });

    signupNotifier.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sns:Publish'],
        resources: [alertTopicArn],
      }),
    );

    // サインアップの確認が済んだら呼ばれる（呼び出し許可も一緒に付く）
    this.userPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, signupNotifier);

    // 通知の失敗はサインアップを守るため Lambda 内で握りつぶす。
    // そのままでは誰も気づけないので、ログからメトリクスに起こして監視する
    this.signupNotifyFailMetricFilter = new logs.MetricFilter(this, 'SignupNotifyFailMetricFilter', {
      logGroup: signupNotifier.logGroup,
      filterPattern: logs.FilterPattern.literal('{ $.level = "ERROR" && $.action = "notifySignup" }'),
      metricNamespace: `${props.envName}-sakekasu`,
      metricName: 'SignupNotifyFailCount',
      metricValue: '1',
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
