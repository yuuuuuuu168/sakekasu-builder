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

  // 他人のキーを書いた記録を作れると、削除時に他人の画像を消せてしまう
  it.each(['createPurchaseRecord', 'createDrinkingRecord'])(
    '%s リゾルバーが imageKey の所有者を検証している',
    (fieldName) => {
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: 'Mutation',
        FieldName: fieldName,
        Code: Match.stringLikeRegexp('imageKey must belong to the requester'),
      });
    },
  );

  it.each(['createPurchaseRecord', 'createDrinkingRecord'])(
    '%s リゾルバーが imageKeys の各要素も検証している',
    (fieldName) => {
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: 'Mutation',
        FieldName: fieldName,
        Code: Match.stringLikeRegexp('imageKeys must belong to the requester'),
      });
    },
  );

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
    const targets = ['dev-sakekasu-ocr-analyzer', 'dev-sakekasu-presigned-url'];

    it.each(targets)('%s の X-Ray アクティブトレースが有効である', (functionName) => {
      // レイヤーに依存せず Lambda 単体で動くぶん。計装を外しても残している
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: functionName,
        TracingConfig: { Mode: 'Active' },
      });
    });

    it.each(targets)('%s のアーキテクチャを明示している', (functionName) => {
      // レイヤーを付け直すときに既定値と噛み合わなくなるのを防ぐ
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: functionName,
        Architectures: ['x86_64'],
      });
    });

    it('起動ラッパーを指定した関数が無い（実機で確認できていないレイヤーを使わない）', () => {
      // ラッパーだけ指定してレイヤーに実体が無いと、関数は Runtime.ExitError で
      // 起動しなくなる。実際にこれで画像アップロードを全滅させた。
      // 付け直すときは、レイヤーに /opt/otel-instrument があることを
      // 実機で確かめてからこのテストを変える
      const withWrapper = Object.values(template.findResources('AWS::Lambda::Function')).filter(
        (fn) => fn.Properties?.Environment?.Variables?.AWS_LAMBDA_EXEC_WRAPPER !== undefined,
      );

      expect(withWrapper).toHaveLength(0);
    });

    it('レイヤーを付けた関数が無い', () => {
      const withLayers = Object.values(template.findResources('AWS::Lambda::Function')).filter(
        (fn) => (fn.Properties?.Layers ?? []).length > 0,
      );

      expect(withLayers).toHaveLength(0);
    });
  });
});
