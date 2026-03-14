import * as cdk from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
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
  /** Image Storage S3 バケット */
  public readonly imageBucket: s3.Bucket;

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

    // Image Storage S3 バケット
    this.imageBucket = new s3.Bucket(this, 'ImageStorage', {
      bucketName: `${props.envName}-sakekasu-images`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy,
      cors: [
        {
          allowedOrigins: [
            'https://sakekasu-builder.com',
            'https://*.amplifyapp.com',
            'http://localhost:5173',
          ],
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
    });

    // Presigned URL 生成 Lambda 関数
    const presignedUrlFunction = new NodejsFunction(
      this,
      'PresignedUrlFunction',
      {
        functionName: `${props.envName}-sakekasu-presigned-url`,
        runtime: Runtime.NODEJS_20_X,
        entry: path.join(
          path.dirname(url.fileURLToPath(import.meta.url)),
          '../lambda/presigned-url/index.ts',
        ),
        handler: 'handler',
        environment: {
          BUCKET_NAME: this.imageBucket.bucketName,
          UPLOAD_EXPIRY: '300',
          DOWNLOAD_EXPIRY: '3600',
        },
        bundling: {
          format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
          mainFields: ['module', 'main'],
          banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
        },
      },
    );

    // Lambda に S3 読み書き権限を付与
    this.imageBucket.grantReadWrite(presignedUrlFunction);

    // AppSync Lambda データソース
    const presignedUrlDataSource = this.graphqlApi.addLambdaDataSource(
      'PresignedUrlDataSource',
      presignedUrlFunction,
    );

    // generateUploadUrl ミューテーションリゾルバー
    presignedUrlDataSource.createResolver('GenerateUploadUrlResolver', {
      typeName: 'Mutation',
      fieldName: 'generateUploadUrl',
    });

    // getDownloadUrl クエリリゾルバー
    presignedUrlDataSource.createResolver('GetDownloadUrlResolver', {
      typeName: 'Query',
      fieldName: 'getDownloadUrl',
    });

    // OCR Analyzer Lambda 関数
    const ocrAnalyzerFunction = new NodejsFunction(this, 'OcrAnalyzerFunction', {
      functionName: `${props.envName}-sakekasu-ocr-analyzer`,
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(
        path.dirname(url.fileURLToPath(import.meta.url)),
        '../lambda/ocr-analyzer/index.ts',
      ),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        BUCKET_NAME: this.imageBucket.bucketName,
        BEDROCK_MODEL_ID: 'anthropic.claude-haiku-4-5-20251001-v1:0',
      },
      bundling: {
        format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
        mainFields: ['module', 'main'],
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });

    // S3 読み取り権限
    this.imageBucket.grantRead(ocrAnalyzerFunction);

    // Bedrock InvokeModel 権限
    ocrAnalyzerFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));

    // AppSync Lambda データソース + リゾルバー
    const ocrDataSource = this.graphqlApi.addLambdaDataSource(
      'OcrAnalyzerDataSource',
      ocrAnalyzerFunction,
    );

    ocrDataSource.createResolver('AnalyzeSakeLabelResolver', {
      typeName: 'Mutation',
      fieldName: 'analyzeSakeLabel',
    });

    // リゾルバーを登録
    this.createResolvers(this.purchaseDataSource, 'PurchaseRecord', presignedUrlDataSource);
    this.createResolvers(this.drinkingDataSource, 'DrinkingRecord', presignedUrlDataSource);

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
    lambdaDataSource: appsync.LambdaDataSource,
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

    // delete ミューテーション（Pipeline リゾルバー: DynamoDB 削除 → S3 画像削除）
    // ステップ1: DynamoDB から記録を取得（imageKey含む）して削除
    const deleteRecordFunction = new appsync.AppsyncFunction(
      this,
      `Delete${typeName}Function`,
      {
        name: `Delete${typeName}Function`,
        api: this.graphqlApi,
        dataSource: dataSource,
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
  // 削除された記録を stash に保存（imageKey を次のステップで使用）
  ctx.stash.deletedRecord = ctx.result;
  return ctx.result;
}
`),
      },
    );

    // ステップ2: imageKey が存在する場合、Lambda 経由で S3 画像削除
    const deleteImageFunction = new appsync.AppsyncFunction(
      this,
      `DeleteImage${typeName}Function`,
      {
        name: `DeleteImage${typeName}Function`,
        api: this.graphqlApi,
        dataSource: lambdaDataSource,
        runtime: jsRuntime,
        code: appsync.Code.fromInline(`
export function request(ctx) {
  const deletedRecord = ctx.stash.deletedRecord;
  const imageKey = deletedRecord && deletedRecord.imageKey ? deletedRecord.imageKey : null;

  if (!imageKey) {
    return { operation: 'Invoke', payload: { info: { fieldName: 'deleteImage' }, arguments: {}, identity: ctx.identity } };
  }

  return { operation: 'Invoke', payload: { info: { fieldName: 'deleteImage' }, arguments: { imageKey: imageKey }, identity: ctx.identity } };
}

export function response(ctx) {
  if (ctx.error) {
    util.appendError(ctx.error.message, ctx.error.type);
  }
  return ctx.stash.deletedRecord;
}
`),
      },
    );

    // Pipeline リゾルバー
    this.graphqlApi.createResolver(`Delete${typeName}Resolver`, {
      typeName: 'Mutation',
      fieldName: `delete${typeName}`,
      runtime: jsRuntime,
      pipelineConfig: [deleteRecordFunction, deleteImageFunction],
      code: appsync.Code.fromInline(`
export function request(ctx) {
  return {};
}

export function response(ctx) {
  return ctx.prev.result;
}
`),
    });
  }
}
