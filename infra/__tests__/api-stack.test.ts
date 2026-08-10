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

  // 画像の削除失敗でミューテーションを失敗にしない。
  // 1段目で記録は既に消えているため、中断すると「削除に失敗した」と返しながら
  // 記録は無い状態になる。消し残しは ImageDeleteFailCount のアラームで拾う
  it('画像削除の失敗ではパイプラインを止めない', () => {
    const functions = template.findResources('AWS::AppSync::FunctionConfiguration');
    const deleteImageFunctions = Object.values(functions).filter((fn) =>
      String(fn.Properties?.Name ?? '').startsWith('DeleteImage'),
    );

    expect(deleteImageFunctions.length).toBeGreaterThan(0);
    for (const fn of deleteImageFunctions) {
      expect(fn.Properties?.Code).toContain('util.appendError(');
      // 呼び出しだけを見る。コメントでの言及は対象外
      expect(fn.Properties?.Code).not.toContain('util.error(');
    }
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

    // ラッパーだけ指定してレイヤーに実体が無いと、関数は Runtime.ExitError で
    // 起動しなくなる。実際にこれで画像アップロードを全滅させた（PR #110）。
    //
    // Node.js 向けの AWS 製レイヤーは2種類あり、起動ラッパーの名前が違う。
    // - AWSOpenTelemetryDistroJs（Application Signals 用）→ /opt/otel-instrument
    // - aws-otel-nodejs-amd64-ver-*（汎用 ADOT）        → /opt/otel-handler
    // 前回は後者のレイヤーに前者のラッパー名を組み合わせて落ちた。
    // ラッパー名だけを見ても正誤は決まらないので、レイヤーとの組み合わせで固定する。
    it('OCR は Application Signals のレイヤーとラッパーが揃っている', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'dev-sakekasu-ocr-analyzer',
        Layers: Match.arrayWith([Match.stringLikeRegexp('AWSOpenTelemetryDistroJs')]),
        Environment: {
          Variables: Match.objectLike({
            AWS_LAMBDA_EXEC_WRAPPER: '/opt/otel-instrument',
          }),
        },
      });
    });

    it('OCR の実行ロールに Application Signals の権限が付いている', () => {
      // レイヤーが起動してもこの権限が無いとテレメトリが送れず、
      // 「動いているのに何も出ない」状態になる
      template.hasResourceProperties('AWS::IAM::Role', {
        ManagedPolicyArns: Match.arrayWith([
          Match.objectLike({
            'Fn::Join': Match.arrayWith([
              Match.arrayWith([
                Match.stringLikeRegexp(
                  'CloudWatchLambdaApplicationSignalsExecutionRolePolicy',
                ),
              ]),
            ]),
          }),
        ]),
      });
    });

    // 前回は2関数へ同時に入れて両方止め、画像アップロードの動線ごと失った。
    // OCR で様子を見てから広げる。広げるときにこのテストを書き換える
    it('presigned-url にはまだ計装を入れていない', () => {
      const functions = template.findResources('AWS::Lambda::Function', {
        Properties: { FunctionName: 'dev-sakekasu-presigned-url' },
      });
      const [fn] = Object.values(functions);

      expect(fn).toBeDefined();
      expect(fn.Properties?.Environment?.Variables?.AWS_LAMBDA_EXEC_WRAPPER).toBeUndefined();
      expect(fn.Properties?.Layers ?? []).toHaveLength(0);
    });

    // ラッパーを指定した関数には必ずレイヤーが要る。片方だけの状態が
    // 起動不能を招くので、組み合わせが崩れていないかを横断で見る
    it('起動ラッパーを指定した関数には必ずレイヤーが付いている', () => {
      const withWrapper = Object.entries(
        template.findResources('AWS::Lambda::Function'),
      ).filter(
        ([, fn]) => fn.Properties?.Environment?.Variables?.AWS_LAMBDA_EXEC_WRAPPER !== undefined,
      );

      expect(withWrapper.length).toBeGreaterThan(0);
      for (const [logicalId, fn] of withWrapper) {
        expect(
          fn.Properties?.Layers ?? [],
          `${logicalId} はラッパーを指定しているのにレイヤーが無い`,
        ).not.toHaveLength(0);
      }
    });
  });
});
