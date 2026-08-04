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
});
