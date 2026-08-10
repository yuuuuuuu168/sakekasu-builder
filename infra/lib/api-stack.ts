import * as cdk from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Architecture, Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import * as path from 'node:path';
import * as url from 'node:url';
import type { Construct } from 'constructs';

// Application Signals の ADOT 計装（Issue #86）はいったん外した。
//
// AWS_LAMBDA_EXEC_WRAPPER に /opt/otel-instrument を指定したが、これは
// Python 用のラッパー名だった。Node.js 用は /opt/otel-handler。
// 存在しないパスを指定するとラッパーの解決に失敗した時点で関数が
// Runtime.ExitError で落ち、画像アップロードが全滅した。
// レイヤーの「実在」は確認したが「中身」を確認していなかった。
//
// X-Ray のアクティブトレースだけは残している。こちらはレイヤーに依存せず、
// Lambda 単体で動いて害がない。
//
// 再挑戦は Issue #86 で、レイヤーの中身を実機で確かめ、1関数だけに入れて
// 起動を確認してから広げる。

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
  /** Presigned URL 発行 Lambda（監視スタックから参照する） */
  public readonly presignedUrlFunction: NodejsFunction;
  /** ラベル画像 OCR Lambda（監視スタックから参照する） */
  public readonly ocrAnalyzerFunction: NodejsFunction;
  /**
   * 画像削除失敗のメトリクスフィルター。
   * アラーム自体は監視スタック側で作る（通知先の SNS を参照すると
   * このスタックが監視スタックに依存し、循環参照になるため）
   */
  public readonly imageDeleteFailMetricFilter: logs.MetricFilter;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // 利用者の記録・画像は dev 環境にも実データが入るため、環境名によらず
    // スタック削除時に残す。削除する場合は明示的に手動操作を要求する
    const removalPolicy = cdk.RemovalPolicy.RETAIN;

    // PurchaseRecord テーブル
    this.purchaseTable = new dynamodb.Table(this, 'PurchaseRecordTable', {
      tableName: `${props.envName}-sakekasu-purchase-records`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
      // 誤操作・誤った変更からの復旧手段（35日以内の任意時点に復元可能）
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      // API/コンソールからの誤削除を拒否する（削除には明示的な無効化が必要）
      deletionProtection: true,
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
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
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
      // 画像の誤削除・誤上書きから復旧できるようにする
      versioned: true,
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
    this.presignedUrlFunction = new NodejsFunction(
      this,
      'PresignedUrlFunction',
      {
        functionName: `${props.envName}-sakekasu-presigned-url`,
        runtime: Runtime.NODEJS_22_X,
        entry: path.join(
          path.dirname(url.fileURLToPath(import.meta.url)),
          '../lambda/presigned-url/index.ts',
        ),
        handler: 'handler',
        // ADOT レイヤーが x86_64 版なので明示して合わせる
        architecture: Architecture.X86_64,
        // Application Signals と一緒に使うと、リクエスト単位で
        // どこに時間がかかったかまで辿れる
        tracing: Tracing.ACTIVE,
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
    this.imageBucket.grantReadWrite(this.presignedUrlFunction);

    // S3 画像削除失敗の CloudWatch メトリクスフィルター
    this.imageDeleteFailMetricFilter = new logs.MetricFilter(this, 'ImageDeleteFailMetricFilter', {
      logGroup: this.presignedUrlFunction.logGroup,
      filterPattern: logs.FilterPattern.literal('{ $.level = "ERROR" && $.action = "deleteImage" }'),
      metricNamespace: `${props.envName}-sakekasu`,
      metricName: 'ImageDeleteFailCount',
      metricValue: '1',
    });

    // 削除失敗アラームは監視スタックで作る（通知先と一緒に管理するため）

    // AppSync Lambda データソース
    const presignedUrlDataSource = this.graphqlApi.addLambdaDataSource(
      'PresignedUrlDataSource',
      this.presignedUrlFunction,
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
    this.ocrAnalyzerFunction = new NodejsFunction(this, 'OcrAnalyzerFunction', {
      functionName: `${props.envName}-sakekasu-ocr-analyzer`,
      runtime: Runtime.NODEJS_22_X,
      entry: path.join(
        path.dirname(url.fileURLToPath(import.meta.url)),
        '../lambda/ocr-analyzer/index.ts',
      ),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      architecture: Architecture.X86_64,
      tracing: Tracing.ACTIVE,
      environment: {
        BUCKET_NAME: this.imageBucket.bucketName,
        BEDROCK_MODEL_ID: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0',
      },
      bundling: {
        format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
        mainFields: ['module', 'main'],
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });

    // S3 読み取り権限
    this.imageBucket.grantRead(this.ocrAnalyzerFunction);

    // Bedrock InvokeModel 権限
    this.ocrAnalyzerFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));

    // AppSync Lambda データソース + リゾルバー
    const ocrDataSource = this.graphqlApi.addLambdaDataSource(
      'OcrAnalyzerDataSource',
      this.ocrAnalyzerFunction,
    );

    ocrDataSource.createResolver('AnalyzeSakeLabelResolver', {
      typeName: 'Mutation',
      fieldName: 'analyzeSakeLabel',
    });

    // リゾルバーを登録
    this.createResolvers(this.purchaseDataSource, 'PurchaseRecord', presignedUrlDataSource);
    this.createResolvers(this.drinkingDataSource, 'DrinkingRecord', presignedUrlDataSource);

    // 在庫から飲酒記録を登録したときの「開封」専用リゾルバー。
    // 汎用の updatePurchaseRecord と分けているのは、未開封のときだけ更新する条件を
    // 付けたいため（汎用側に条件を付けるとステータスの手動切り替えが壊れる）
    this.createMarkPurchaseOpenedResolver();

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
   * markPurchaseOpened リゾルバーを作成する。
   *
   * 未開封（drinkingStatus が NOT_STARTED、または飲みきり機能導入前で属性なし）の
   * ときだけ「飲み中」にして開封日時を記録する。すでに開封済み・他人の記録の場合は
   * 条件式で弾き、エラーではなく null を返して呼び出し側に「変更なし」を伝える。
   * これにより再送・二重送信・端末間のズレがあっても openedAt は上書きされない。
   */
  private createMarkPurchaseOpenedResolver(): void {
    this.purchaseDataSource.createResolver('MarkPurchaseOpenedResolver', {
      typeName: 'Mutation',
      fieldName: 'markPurchaseOpened',
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  const now = util.time.nowISO8601();
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ id: ctx.args.id }),
    update: {
      expression: 'SET #drinkingStatus = :inProgress, #openedAt = :now, #updatedAt = :now',
      expressionNames: {
        '#drinkingStatus': 'drinkingStatus',
        '#openedAt': 'openedAt',
        '#updatedAt': 'updatedAt',
      },
      expressionValues: util.dynamodb.toMapValues({ ':inProgress': 'IN_PROGRESS', ':now': now }),
    },
    condition: {
      expression:
        '#owner = :expectedOwner AND (attribute_not_exists(#drinkingStatus) OR #drinkingStatus = :notStarted)',
      expressionNames: { '#owner': 'owner', '#drinkingStatus': 'drinkingStatus' },
      expressionValues: util.dynamodb.toMapValues({
        ':expectedOwner': ctx.identity.sub,
        ':notStarted': 'NOT_STARTED',
      }),
    },
  };
}

export function response(ctx) {
  if (ctx.error) {
    // 条件不成立（開封済み or 他人の記録）は「変更なし」として扱う。
    // 所有者かどうかを応答から区別できないようにする意図もある
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      return null;
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
`),
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

  // 画像キーは自分のものだけを受け付ける。
  // 他人のキーを書いた記録を作れると、その記録を削除したときに
  // 削除パイプラインが他人の画像を消してしまう
  const prefix = ctx.identity.sub + '/';
  if (input.imageKey && !input.imageKey.startsWith(prefix)) {
    util.error('Unauthorized: imageKey must belong to the requester', 'Unauthorized');
  }
  if (input.imageKeys) {
    for (const key of input.imageKeys) {
      if (!key.startsWith(prefix)) {
        util.error('Unauthorized: imageKeys must belong to the requester', 'Unauthorized');
      }
    }
  }

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

    // list クエリ（limit/nextToken によるページネーション対応）
    dataSource.createResolver(`List${typeName}sResolver`, {
      typeName: 'Query',
      fieldName: `list${typeName}s`,
      runtime: jsRuntime,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  const req = {
    operation: 'Query',
    index: 'owner-index',
    query: {
      expression: '#owner = :owner',
      expressionNames: { '#owner': 'owner' },
      expressionValues: util.dynamodb.toMapValues({ ':owner': ctx.identity.sub }),
    },
    limit: ctx.args.limit ?? 100,
  };
  if (ctx.args.nextToken) {
    req.nextToken = ctx.args.nextToken;
  }
  return req;
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return { items: ctx.result.items, nextToken: ctx.result.nextToken };
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
  const imageKeys = deletedRecord && deletedRecord.imageKeys ? deletedRecord.imageKeys : null;

  if (!imageKey && (!imageKeys || imageKeys.length === 0)) {
    return { operation: 'Invoke', payload: { info: { fieldName: 'deleteImage' }, arguments: {}, identity: ctx.identity } };
  }

  return { operation: 'Invoke', payload: { info: { fieldName: 'deleteImage' }, arguments: { imageKey: imageKey, imageKeys: imageKeys }, identity: ctx.identity } };
}

export function response(ctx) {
  if (ctx.error) {
    // このスタックで唯一 util.error ではなく appendError を使う場所。
    //
    // 1段目で記録は既に削除されている。ここで中断すると「削除に失敗した」と
    // 返しながら記録は存在しない状態になり、利用者が再試行しても直せない。
    // 画像の消し残しは記録の削除そのものとは別の問題なので、
    // ミューテーション自体は成功として返す。
    //
    // 握りつぶしているわけではない。Lambda 側は失敗を level=ERROR /
    // action=deleteImage のログに出しており、ImageDeleteFailCount の
    // メトリクスフィルター経由で監視スタックのアラームから Slack に届く。
    // 消し残しは運用側で拾って対処する
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
