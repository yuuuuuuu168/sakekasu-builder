import { Template, Match } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack.js';
import { ApiStack } from '../lib/api-stack.js';

describe('ApiStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const authStack = new AuthStack(app, 'TestAuthStack', {
      envName: 'dev',
    });
    const apiStack = new ApiStack(app, 'TestApiStack', {
      envName: 'dev',
      userPool: authStack.userPool,
    });
    template = Template.fromStack(apiStack);
  });

  // Requirements 3.1: AppSync API が Cognito UserPool 認証モードで作成されている
  it('AppSync API が Cognito UserPool を既定の認証モードとして設定している', () => {
    template.hasResourceProperties('AWS::AppSync::GraphQLApi', {
      AuthenticationType: 'AMAZON_COGNITO_USER_POOLS',
    });
  });

  // Requirements 4.1: PurchaseRecord テーブルのパーティションキー
  it('PurchaseRecord テーブルが id (S) をパーティションキーとして持つ', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'dev-sakekasu-purchase-records',
      KeySchema: Match.arrayWith([
        { AttributeName: 'id', KeyType: 'HASH' },
      ]),
      AttributeDefinitions: Match.arrayWith([
        { AttributeName: 'id', AttributeType: 'S' },
      ]),
    });
  });

  // Requirements 4.2: DrinkingRecord テーブルのパーティションキー
  it('DrinkingRecord テーブルが id (S) をパーティションキーとして持つ', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'dev-sakekasu-drinking-records',
      KeySchema: Match.arrayWith([
        { AttributeName: 'id', KeyType: 'HASH' },
      ]),
      AttributeDefinitions: Match.arrayWith([
        { AttributeName: 'id', AttributeType: 'S' },
      ]),
    });
  });

  // Requirements 4.3: 両テーブルが PAY_PER_REQUEST 課金モード
  it('PurchaseRecord テーブルが PAY_PER_REQUEST 課金モードを使用している', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'dev-sakekasu-purchase-records',
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('DrinkingRecord テーブルが PAY_PER_REQUEST 課金モードを使用している', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'dev-sakekasu-drinking-records',
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  // Requirements 4.4: 両テーブルに owner-index GSI が存在する
  it('PurchaseRecord テーブルに owner-index GSI が存在する', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'dev-sakekasu-purchase-records',
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'owner-index',
          KeySchema: Match.arrayWith([
            { AttributeName: 'owner', KeyType: 'HASH' },
          ]),
          Projection: { ProjectionType: 'ALL' },
        }),
      ]),
    });
  });

  it('DrinkingRecord テーブルに owner-index GSI が存在する', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'dev-sakekasu-drinking-records',
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'owner-index',
          KeySchema: Match.arrayWith([
            { AttributeName: 'owner', KeyType: 'HASH' },
          ]),
          Projection: { ProjectionType: 'ALL' },
        }),
      ]),
    });
  });

  // Requirements 3.5, 4.6: AppSync リゾルバーが存在する
  it('AppSync リゾルバーが存在する', () => {
    // CRUD 13本 + markPurchaseOpened
    template.resourceCountIs('AWS::AppSync::Resolver', 14);
  });

  // 在庫からの開封は未開封のときだけ更新する（openedAt の上書き防止）
  it('markPurchaseOpened リゾルバーが未開封を条件にしている', () => {
    template.hasResourceProperties('AWS::AppSync::Resolver', {
      TypeName: 'Mutation',
      FieldName: 'markPurchaseOpened',
      Code: Match.stringLikeRegexp('attribute_not_exists\\(#drinkingStatus\\) OR #drinkingStatus = :notStarted'),
    });
  });

  // Requirements 3.7: GraphqlApiUrl の CfnOutput が存在する
  it('GraphqlApiUrl の CfnOutput が存在する', () => {
    template.hasOutput('GraphqlApiUrl', {});
  });

  // Requirements 3.7: ApiRegion の CfnOutput が存在する
  it('ApiRegion の CfnOutput が存在する', () => {
    template.hasOutput('ApiRegion', {});
  });

  // Issue #86: Application Signals の計装
  describe('Application Signals の計装', () => {
    const instrumented = [
      'dev-sakekasu-ocr-analyzer',
      'dev-sakekasu-presigned-url',
    ];

    it.each(instrumented)('%s に ADOT レイヤーと起動ラッパーが入っている', (functionName) => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: functionName,
        Layers: Match.arrayWith([
          Match.stringLikeRegexp('^arn:aws:lambda:ap-northeast-1:901920570463:layer:aws-otel-nodejs-amd64-'),
        ]),
        Environment: {
          Variables: Match.objectLike({
            AWS_LAMBDA_EXEC_WRAPPER: '/opt/otel-instrument',
          }),
        },
      });
    });

    it.each(instrumented)('%s のアーキテクチャがレイヤーと揃っている', (functionName) => {
      // レイヤーは amd64 版。arm64 に変わると起動時に噛み合わなくなる
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: functionName,
        Architectures: ['x86_64'],
      });
    });

    it.each(instrumented)('%s の X-Ray アクティブトレースが有効である', (functionName) => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: functionName,
        TracingConfig: { Mode: 'Active' },
      });
    });

    it('計装した関数の実行ロールに Application Signals 用の管理ポリシーが付いている', () => {
      const roles = Object.values(template.findResources('AWS::IAM::Role')).filter((role) =>
        JSON.stringify(role.Properties?.ManagedPolicyArns ?? []).includes(
          'CloudWatchLambdaApplicationSignalsExecutionRolePolicy',
        ),
      );

      // OCR と presigned-url の2つ
      expect(roles).toHaveLength(2);
    });

    it('レイヤーと違うリージョンに置こうとすると合成の時点で止まる', () => {
      // レイヤーは同じリージョンのものしか付けられない。ここで止めないと、
      // デプロイは通ってコールドスタートだけが落ちる
      const otherRegion = new cdk.App();
      const auth = new AuthStack(otherRegion, 'OtherRegionAuth', {
        envName: 'dev',
        env: { account: '<アプリのアカウント ID>', region: 'us-east-1' },
      });

      expect(
        () =>
          new ApiStack(otherRegion, 'OtherRegionApi', {
            envName: 'dev',
            userPool: auth.userPool,
            env: { account: '<アプリのアカウント ID>', region: 'us-east-1' },
          }),
      ).toThrow(/us-east-1 のものではありません/);
    });

    it('監視系の関数までは計装しない（ノイズと費用を増やさない）', () => {
      const functions = Object.values(template.findResources('AWS::Lambda::Function'));
      const instrumentedNames = functions
        .filter((fn) => (fn.Properties?.Layers ?? []).length > 0)
        .map((fn) => fn.Properties?.FunctionName as string);

      expect(instrumentedNames.sort()).toEqual([...instrumented].sort());
    });
  });
});
