import * as cdk from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as path from 'node:path';
import * as url from 'node:url';
import type { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  /** 環境名（dev, staging, prod） */
  envName: string;
  /** AuthStack から受け取る UserPool */
  userPool: cognito.UserPool;
}

export class ApiStack extends cdk.Stack {
  /** PurchaseRecord DynamoDB テーブル */
  public readonly purchaseTable: dynamodb.Table;
  /** DrinkingRecord DynamoDB テーブル */
  public readonly drinkingTable: dynamodb.Table;
  /** AppSync GraphQL API */
  public readonly graphqlApi: appsync.GraphqlApi;
  /** PurchaseRecord DynamoDB データソース */
  public readonly purchaseDataSource: appsync.DynamoDbDataSource;
  /** DrinkingRecord DynamoDB データソース */
  public readonly drinkingDataSource: appsync.DynamoDbDataSource;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const removalPolicy =
      props.envName === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY;

    // PurchaseRecord テーブル
    this.purchaseTable = new dynamodb.Table(this, 'PurchaseRecordTable', {
      tableName: `${props.envName}-sakekasu-purchase-records`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });

    this.purchaseTable.addGlobalSecondaryIndex({
      indexName: 'owner-index',
      partitionKey: { name: 'owner', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // DrinkingRecord テーブル
    this.drinkingTable = new dynamodb.Table(this, 'DrinkingRecordTable', {
      tableName: `${props.envName}-sakekasu-drinking-records`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });

    this.drinkingTable.addGlobalSecondaryIndex({
      indexName: 'owner-index',
      partitionKey: { name: 'owner', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // AppSync GraphQL API
    this.graphqlApi = new appsync.GraphqlApi(this, 'SakekasuApi', {
      name: `${props.envName}-sakekasu-api`,
      definition: appsync.Definition.fromFile(
        path.join(
          path.dirname(url.fileURLToPath(import.meta.url)),
          '../graphql/schema.graphql',
        ),
      ),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: {
            userPool: props.userPool,
          },
        },
      },
    });

    // DynamoDB データソース
    this.purchaseDataSource = this.graphqlApi.addDynamoDbDataSource(
      'PurchaseDataSource',
      this.purchaseTable,
    );
    this.drinkingDataSource = this.graphqlApi.addDynamoDbDataSource(
      'DrinkingDataSource',
      this.drinkingTable,
    );

    // リゾルバーを登録
    this.createResolvers(this.purchaseDataSource, 'PurchaseRecord');
    this.createResolvers(this.drinkingDataSource, 'DrinkingRecord');

    // CloudFormation 出力
    new cdk.CfnOutput(this, 'GraphqlApiUrl', {
      value: this.graphqlApi.graphqlUrl,
      description: 'GraphQL API エンドポイント URL',
    });

    new cdk.CfnOutput(this, 'ApiRegion', {
      value: this.region,
      description: 'API リソースの AWS リージョン',
    });
  }

  /**
   * 指定されたレコード型の CRUD リゾルバーを作成するヘルパー
   */
  private createResolvers(
    dataSource: appsync.DynamoDbDataSource,
    typeName: string,
  ): void {
    const jsRuntime = appsync.FunctionRuntime.JS_1_0_0;

    // create ミューテーション
    dataSource.createResolver(`Create${typeName}Resolver`, {
      typeName: 'Mutation',
      fieldName: `create${typeName}`,
      runtime: jsRuntime,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  const now = util.time.nowISO8601();
  const input = ctx.args.input;
  const item = {
    ...input,
    id: util.autoId(),
    owner: ctx.identity.sub,
    createdAt: now,
    updatedAt: now,
  };
  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({ id: item.id }),
    attributeValues: util.dynamodb.toMapValues(item),
  };
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
`),
    });

    // list クエリ
    dataSource.createResolver(`List${typeName}sResolver`, {
      typeName: 'Query',
      fieldName: `list${typeName}s`,
      runtime: jsRuntime,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  return {
    operation: 'Query',
    index: 'owner-index',
    query: {
      expression: '#owner = :owner',
      expressionNames: { '#owner': 'owner' },
      expressionValues: util.dynamodb.toMapValues({ ':owner': ctx.identity.sub }),
    },
  };
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result.items;
}
`),
    });

    // get クエリ
    dataSource.createResolver(`Get${typeName}Resolver`, {
      typeName: 'Query',
      fieldName: `get${typeName}`,
      runtime: jsRuntime,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({ id: ctx.args.id }),
  };
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  const result = ctx.result;
  if (!result) {
    return null;
  }
  if (result.owner !== ctx.identity.sub) {
    util.unauthorized();
  }
  return result;
}
`),
    });

    // update ミューテーション（条件式で owner 検証 + UpdateItem）
    dataSource.createResolver(`Update${typeName}Resolver`, {
      typeName: 'Mutation',
      fieldName: `update${typeName}`,
      runtime: jsRuntime,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  const input = ctx.args.input;
  const now = util.time.nowISO8601();

  // input から id を除いた更新フィールドを構築
  const expParts = [];
  const expNames = {};
  const expValues = {};

  const keys = Object.keys(input);
  for (const key of keys) {
    if (key !== 'id') {
      expParts.push('#' + key + ' = :' + key);
      expNames['#' + key] = key;
      expValues[':' + key] = input[key];
    }
  }

  // updatedAt を常に更新
  expParts.push('#updatedAt = :updatedAt');
  expNames['#updatedAt'] = 'updatedAt';
  expValues[':updatedAt'] = now;

  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ id: input.id }),
    update: {
      expression: 'SET ' + expParts.join(', '),
      expressionNames: expNames,
      expressionValues: util.dynamodb.toMapValues(expValues),
    },
    condition: {
      expression: '#owner = :expectedOwner',
      expressionNames: { '#owner': 'owner' },
      expressionValues: util.dynamodb.toMapValues({ ':expectedOwner': ctx.identity.sub }),
    },
  };
}

export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Unauthorized: owner mismatch', 'Unauthorized');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
`),
    });

    // delete ミューテーション（条件式で owner 検証 + DeleteItem）
    dataSource.createResolver(`Delete${typeName}Resolver`, {
      typeName: 'Mutation',
      fieldName: `delete${typeName}`,
      runtime: jsRuntime,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  return {
    operation: 'DeleteItem',
    key: util.dynamodb.toMapValues({ id: ctx.args.id }),
    condition: {
      expression: '#owner = :expectedOwner',
      expressionNames: { '#owner': 'owner' },
      expressionValues: util.dynamodb.toMapValues({ ':expectedOwner': ctx.identity.sub }),
    },
  };
}

export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Unauthorized: owner mismatch', 'Unauthorized');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
`),
    });
  }
}
