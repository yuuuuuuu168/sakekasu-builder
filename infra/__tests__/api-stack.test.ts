import { Template, Match } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import {
  ApiStack,
  assertInferenceProfileMatchesFoundationModel,
  enableApplicationSignals,
} from '../lib/api-stack.js';
import { TEST_SHARED_AUTH } from './shared-auth-fixture.js';

/**
 * 関数名から実行ロールのリソース定義を引く。
 *
 * `hasResourceProperties('AWS::IAM::Role', ...)` は型が一致するリソースを
 * 総なめして1つでも当たれば通る。ロールに何かが付いていることを確かめたい
 * 場面では、隣の関数のロールで通ってしまい検査にならない
 */
type RoleResource = { Properties?: { ManagedPolicyArns?: unknown } };

function executionRoleOf(template: Template, functionName: string): RoleResource {
  const [fn] = Object.values(
    template.findResources('AWS::Lambda::Function', {
      Properties: { FunctionName: functionName },
    }),
  );
  expect(fn, `${functionName} が見つからない`).toBeDefined();

  // 実行ロールは Fn::GetAtt で参照される。[論理ID, 'Arn'] の形
  const roleLogicalId = fn.Properties?.Role?.['Fn::GetAtt']?.[0];
  expect(roleLogicalId, `${functionName} の Role が論理IDで参照されていない`).toBeDefined();

  const role = template.findResources('AWS::IAM::Role')[roleLogicalId];
  expect(role, `${functionName} の実行ロール ${roleLogicalId} が見つからない`).toBeDefined();
  return role;
}

describe('ApiStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const apiStack = new ApiStack(app, 'TestApiStack', {
      envName: 'dev',
      sharedAuth: TEST_SHARED_AUTH,
    });
    template = Template.fromStack(apiStack);
  });

  // Requirements 3.1: AppSync API が Cognito UserPool 認証モードで作成されている
  it('AppSync API が Cognito UserPool を既定の認証モードとして設定している', () => {
    template.hasResourceProperties('AWS::AppSync::GraphQLApi', {
      AuthenticationType: 'AMAZON_COGNITO_USER_POOLS',
    });
  });

  // 共通ログインへの移行。旧プール（AuthStack。いまは外した）ではなく、cdk.json の sharedAuth の
  // プールを見る。共有プールには他のアプリのクライアントもいるので、builder の
  // クライアントに出たトークンだけを通す
  it('AppSync は共通ログインのプールを見て、builder のクライアントのトークンだけを通す', () => {
    template.hasResourceProperties('AWS::AppSync::GraphQLApi', {
      UserPoolConfig: Match.objectLike({
        UserPoolId: TEST_SHARED_AUTH.userPoolId,
        AppIdClientRegex: `^${TEST_SHARED_AUTH.clientId}$`,
        DefaultAction: 'ALLOW',
      }),
    });
  });

  it('旧プールの Export を読まない（スタック間の参照でつながない）', () => {
    expect(JSON.stringify(template.toJSON())).not.toContain('Fn::ImportValue');
  });

  // Issue #142: 登録後に画像を追加できるようにしたため、更新経路にも
  // 画像キーの所有者検証が要る。無いと他人の画像キーを自分の記録に紐づけられ、
  // その記録を削除したときに削除パイプラインが他人の画像を消してしまう
  describe('画像キーの所有者検証', () => {
    it.each(['PurchaseRecord', 'DrinkingRecord'])(
      '%s の create リゾルバーが画像キーの所有者を検証する',
      (typeName) => {
        template.hasResourceProperties('AWS::AppSync::Resolver', {
          FieldName: `create${typeName}`,
          Code: Match.stringLikeRegexp('imageKeys must belong to the requester'),
        });
      },
    );

    it.each(['PurchaseRecord', 'DrinkingRecord'])(
      '%s の update リゾルバーが画像キーの所有者を検証する',
      (typeName) => {
        template.hasResourceProperties('AWS::AppSync::Resolver', {
          FieldName: `update${typeName}`,
          Code: Match.stringLikeRegexp('imageKeys must belong to the requester'),
        });
      },
    );
  });

  // 一時領域のキーは 1 日で消える。記録に持たせると実体だけが消えて
  // 画像の出ない記録が残る。フロントは保存前に正式な場所へ複製しているが、
  // API を直接叩けばその手順を飛ばせるのでサーバー側でも拒否する（Issue #140）。
  // 更新経路でも画像キーを受け取るようになったため、両方に要る（Issue #142）
  describe('一時領域のキーを記録に保存させない', () => {
    it.each([
      'createPurchaseRecord',
      'createDrinkingRecord',
      'updatePurchaseRecord',
      'updateDrinkingRecord',
    ])('%s リゾルバーが tmp 区画のキーを拒否する', (fieldName) => {
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        FieldName: fieldName,
        Code: Match.stringLikeRegexp('temporary keys cannot be stored in records'),
      });
    });

    it.each([
      'createPurchaseRecord',
      'createDrinkingRecord',
      'updatePurchaseRecord',
      'updateDrinkingRecord',
    ])('%s リゾルバーが区画の位置で判定する（部分一致にしない）', (fieldName) => {
      // ファイル名や sub に tmp が現れても一時領域とは限らない。
      // includes で見ると正式な画像まで拒否してしまう
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        FieldName: fieldName,
        Code: Match.stringLikeRegexp("split\\('/'\\)\\[1\\] === 'tmp'"),
      });
    });

    it.each([
      'createPurchaseRecord',
      'createDrinkingRecord',
      'updatePurchaseRecord',
      'updateDrinkingRecord',
    ])('%s リゾルバーが null 要素で落ちない', (fieldName) => {
      // imageKeys の要素が null だと key.startsWith が実行時エラーになる。
      // スキーマ側でも [String!] にしてあるが、ガードでも受け止める
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        FieldName: fieldName,
        Code: Match.stringLikeRegexp('!!key && key.startsWith'),
      });
    });
  });

  // copyImages にも同じ上限があるが、あちらは複製経路だけを見ている。
  // API を直接叩いて任意の枚数を書き込まれると、getDownloadUrls の上限（100件）に
  // 当たって記録が開けなくなる（PR #146 のレビュー指摘）
  describe('画像の枚数制限', () => {
    it.each([
      'createPurchaseRecord',
      'createDrinkingRecord',
      'updatePurchaseRecord',
      'updateDrinkingRecord',
    ])('%s リゾルバーが 5 枚を超える imageKeys を拒否する', (fieldName) => {
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        FieldName: fieldName,
        Code: Match.stringLikeRegexp('input.imageKeys.length > 5'),
      });
    });

    // 空配列は truthy なのでループの検査を 1 度も通らないまま書き込まれ、
    // 記録から画像への参照だけが消える（PR #146 の 3 巡目レビュー指摘）
    it.each([
      'createPurchaseRecord',
      'createDrinkingRecord',
      'updatePurchaseRecord',
      'updateDrinkingRecord',
    ])('%s リゾルバーが空の imageKeys を拒否する', (fieldName) => {
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        FieldName: fieldName,
        Code: Match.stringLikeRegexp('input.imageKeys.length === 0'),
      });
    });
  });

  // Issue #140: OCR の事前アップロードは記録の作成前に走るため、保存せず離れた
  // 画像が孤児として残る。一時領域はタグ付きで置き、ライフサイクルで自動削除する
  describe('一時アップロードのライフサイクル', () => {
    it('画像バケットが一時オブジェクトを 1 日で削除する', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: 'dev-sakekasu-images',
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Status: 'Enabled',
              ExpirationInDays: 1,
              // プレフィックスは前方一致しか使えず {sub} が可変のため、タグで絞る
              TagFilters: [{ Key: 'lifecycle', Value: 'temporary' }],
            }),
          ]),
        },
      });
    });

    it('バージョニング有効なので旧バージョンも併せて削除する', () => {
      // 現行バージョンだけ消しても旧版が残り、容量が減らない
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: 'dev-sakekasu-images',
        VersioningConfiguration: { Status: 'Enabled' },
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              NoncurrentVersionExpiration: { NoncurrentDays: 1 },
            }),
          ]),
        },
      });
    });
  });

  // SDL の `#` コメントは introspection に出ないため、AppSync コンソールや
  // codegen からは見えない。名前が「ヘッダで送れ」と読める項目なので、
  // 機械可読な警告を付けておく（PR #147 のレビュー指摘）
  describe('taggingHeader の誤用防止', () => {
    it('スキーマで非推奨として印を付けている', () => {
      template.hasResourceProperties('AWS::AppSync::GraphQLSchema', {
        Definition: Match.stringLikeRegexp('@deprecated'),
      });
    });

    it('introspection に出る説明でヘッダ送信を禁じている', () => {
      // `#` コメントではなく `"""` の説明として書かれていること。
      // 前者は introspection に含まれず、読む機会のある場所に届かない
      const schema = Object.values(
        template.findResources('AWS::AppSync::GraphQLSchema'),
      )
        .map((r) => String(r.Properties?.Definition ?? ''))
        .join('\n');

      const descriptionBlocks = schema.match(/"""[\s\S]*?"""/g) ?? [];
      expect(
        descriptionBlocks.some((b) => b.includes('ヘッダとして送ってはいけない')),
      ).toBe(true);
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
    // CRUD 13本 + markPurchaseOpened + getDownloadUrls + copyImages + generateTastingNote
    template.resourceCountIs('AWS::AppSync::Resolver', 17);
  });

  // 在庫から飲むときに購入記録の写真を引き継ぐ経路
  it('画像を複製する copyImages リゾルバーがある', () => {
    template.hasResourceProperties('AWS::AppSync::Resolver', {
      TypeName: 'Mutation',
      FieldName: 'copyImages',
    });
  });

  // 一覧は画像の数だけ URL を要求する。1件ずつ Lambda を呼ぶと同時実行枠を
  // 使い切ってスロットリングされ、URL を取れなかった記録の画像が出なくなる
  it('画像 URL をまとめて取る getDownloadUrls リゾルバーがある', () => {
    template.hasResourceProperties('AWS::AppSync::Resolver', {
      TypeName: 'Query',
      FieldName: 'getDownloadUrls',
    });
  });

  // Issue #159: まとめ買いした酒を1本ずつ飲みきるために残本数を持たせた。
  // フロントは一覧クエリでこの項目を選択しているので、スキーマから落ちると
  // 購入記録の取得そのものが失敗する
  describe('購入記録の残本数', () => {
    const schema = readFileSync(
      path.join(path.dirname(url.fileURLToPath(import.meta.url)), '../graphql/schema.graphql'),
      'utf-8',
    );

    /** 型・入力の定義本文を切り出す */
    function definitionOf(name: string): string {
      const match = schema.match(new RegExp(`(?:type|input) ${name} \\{([^}]*)\\}`));
      expect(match, `${name} の定義が見つからない`).not.toBeNull();
      return match![1];
    }

    it.each(['PurchaseRecord', 'CreatePurchaseRecordInput', 'UpdatePurchaseRecordInput'])(
      '%s が remainingQuantity を持つ',
      (name) => {
        expect(definitionOf(name)).toMatch(/remainingQuantity: Int/);
      },
    );
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

  // Issue #82: Bedrock 呼び出しのコスト保護（IAM を使うモデルだけに絞る）
  describe('Bedrock InvokeModel の権限', () => {
    // 期待値は lib/ から import せず、ここにリテラルで持つ。実装の定数を
    // 参照したり実装と同じ変換をかけ直したりすると、実装が間違っていても
    // テストが同じ間違いをして通る。特に基盤モデルIDは接頭辞を落とす加工を
    // 通した値なので、加工そのものが壊れたときに気づける必要がある
    const EXPECTED_MODEL_ID = 'jp.anthropic.claude-haiku-4-5-20251001-v1:0';
    const EXPECTED_FOUNDATION_MODEL_ID = 'anthropic.claude-haiku-4-5-20251001-v1:0';
    /** 許可してよい ARN の全量。テストのスタックには env を渡していないので疑似パラメータは Ref のまま */
    const EXPECTED_RESOURCES = [
      `arn:\${AWS::Partition}:bedrock:\${AWS::Region}:\${AWS::AccountId}:inference-profile/${EXPECTED_MODEL_ID}`,
      `arn:\${AWS::Partition}:bedrock:ap-northeast-1::foundation-model/${EXPECTED_FOUNDATION_MODEL_ID}`,
      `arn:\${AWS::Partition}:bedrock:ap-northeast-3::foundation-model/${EXPECTED_FOUNDATION_MODEL_ID}`,
    ];

    /** Fn::Join を1本の文字列に潰す。Ref は `${AWS::Partition}` の形で埋める */
    const flattenArn = (resource: unknown): string => {
      if (typeof resource === 'string') return resource;
      const join = (resource as { 'Fn::Join'?: [string, unknown[]] })['Fn::Join'];
      if (!join) return JSON.stringify(resource);
      const [separator, parts] = join;
      return parts
        .map((part) =>
          typeof part === 'string' ? part : `\${${(part as { Ref: string }).Ref}}`,
        )
        .join(separator);
    };

    /**
     * bedrock:InvokeModel を **Allow** している文だけを集める。
     *
     * Effect を見ないと、うっかり Deny になっていても以降の検査が素通りする
     * （ARN は同じまま Effect だけ変わるため、権限が消えているのに緑になる）
     */
    const invokeModelAllowStatements = () => {
      const policies = template.findResources('AWS::IAM::Policy');
      const statements = Object.values(policies).flatMap(
        (policy) => (policy.Properties?.PolicyDocument?.Statement ?? []) as Record<string, unknown>[],
      );
      return statements.filter((statement) => {
        const action = statement.Action;
        const matchesAction = Array.isArray(action)
          ? action.includes('bedrock:InvokeModel')
          : action === 'bedrock:InvokeModel';
        return matchesAction && statement.Effect === 'Allow';
      });
    };

    /** 1つの文が許可している ARN を平坦化して返す */
    const resourcesOf = (statement: Record<string, unknown> | undefined) =>
      [statement?.Resource].flat().map(flattenArn);

    /** すべての Allow 文が許可している ARN */
    const allowedResources = () => invokeModelAllowStatements().flatMap(resourcesOf);

    /** 指定した Lambda に渡しているモデルID */
    const modelIdOf = (functionName: string) => {
      const [fn] = Object.values(
        template.findResources('AWS::Lambda::Function', {
          Properties: { FunctionName: functionName },
        }),
      );
      return fn?.Properties?.Environment?.Variables?.BEDROCK_MODEL_ID as string | undefined;
    };

    /** Bedrock を呼ぶ関数。増えたらここに足す（許可の中身は全関数で同じ） */
    const BEDROCK_FUNCTIONS = ['dev-sakekasu-ocr-analyzer', 'dev-sakekasu-tasting-note'];

    it('推論プロファイルとその振り先 foundation-model だけを許可している', () => {
      const statements = invokeModelAllowStatements();
      // Bedrock を呼ぶ関数の数だけ文がある。関数を足したのに権限を付け忘れた
      // 場合も、逆に無関係な関数へ広げた場合もここで落ちる
      expect(statements).toHaveLength(BEDROCK_FUNCTIONS.length);
      for (const statement of statements) {
        // 部分一致ではなく全量で見る。増えた ARN も減った ARN もここで落ちる
        expect(resourcesOf(statement)).toEqual(EXPECTED_RESOURCES);
      }
    });

    // 元の `*` に戻す以外に、`bedrock:*::foundation-model/*` のように
    // 部分的に緩める直し方がある。ARN 単体の等値比較では素通りするので、
    // 文字列のどこにワイルドカードが出ても落とす
    it('ワイルドカードを含む ARN が混ざっていない', () => {
      for (const resource of allowedResources()) {
        expect(resource, `${resource} にワイルドカードが含まれている`).not.toContain('*');
      }
    });

    // モデルを差し替えたときに ARN の更新を忘れると、デプロイは通るのに
    // Bedrock を呼ぶ処理だけが AccessDeniedException で止まる。
    // ここで気づけるようにする
    it.each(BEDROCK_FUNCTIONS)(
      '%s に渡すモデルIDと許可した推論プロファイルが一致している',
      (functionName) => {
        expect(modelIdOf(functionName)).toBe(EXPECTED_MODEL_ID);
        expect(allowedResources()).toContain(
          `arn:\${AWS::Partition}:bedrock:\${AWS::Region}:\${AWS::AccountId}:inference-profile/${EXPECTED_MODEL_ID}`,
        );
      },
    );

    // Lambda 側にモデルIDのリテラルが残っていると、CDK の定数だけを書き換えた
    // ときに両者がずれる。ずれても CDK のテストは全部通ってしまうため、
    // 実装ファイルを直接見て二重管理そのものを禁じる。
    //
    // 「既定値へ落ちないこと」自体はここでは見ない。ソースの文字列検査では
    // 書き方を変えるだけですり抜けられるため、環境変数を外して実際に呼ぶ
    // lambda/ocr-analyzer/__tests__/resolveModelId.test.ts のほうで見ている
    it.each(['ocr-analyzer', 'tasting-note'])(
      '%s Lambda のソースにモデルIDのリテラルが残っていない',
      (lambdaDir) => {
        const source = readFileSync(
          path.join(
            path.dirname(url.fileURLToPath(import.meta.url)),
            `../lambda/${lambdaDir}/index.ts`,
          ),
          'utf-8',
        );

        expect(source).not.toContain('anthropic.claude');
      },
    );
  });

  // 推論プロファイルIDと基盤モデルIDの対応チェック（Issue #82）。
  // 通ってはいけない組み合わせを並べる。ここが緩いと、実在しない ARN を
  // 許可した状態でデプロイが成功し、本番の OCR だけが止まる
  describe('assertInferenceProfileMatchesFoundationModel', () => {
    it.each([
      ['jp.anthropic.claude-haiku-4-5-20251001-v1:0', 'anthropic.claude-haiku-4-5-20251001-v1:0'],
      // 接頭辞は jp. に限らない。どの接頭辞でも1区切りだけ落とす
      ['us.anthropic.claude-haiku-4-5-20251001-v1:0', 'anthropic.claude-haiku-4-5-20251001-v1:0'],
      ['global.anthropic.claude-haiku-4-5-20251001-v1:0', 'anthropic.claude-haiku-4-5-20251001-v1:0'],
    ])('%s と %s は対応している', (profileId, foundationModelId) => {
      expect(() =>
        assertInferenceProfileMatchesFoundationModel(profileId, foundationModelId),
      ).not.toThrow();
    });

    it.each([
      // anthropic. まで削りすぎ。後方一致だけで見ると通ってしまう組み合わせ
      ['jp.anthropic.claude-haiku-4-5-20251001-v1:0', 'claude-haiku-4-5-20251001-v1:0'],
      // 接頭辞を落とし忘れ
      ['jp.anthropic.claude-haiku-4-5-20251001-v1:0', 'jp.anthropic.claude-haiku-4-5-20251001-v1:0'],
      // 別モデル
      ['jp.anthropic.claude-haiku-4-5-20251001-v1:0', 'anthropic.claude-sonnet-4-5-20250929-v1:0'],
      // 接頭辞の無い素の基盤モデルID。推論プロファイルではないので ARN の形が違う
      ['anthropic.claude-haiku-4-5-20251001-v1:0', 'anthropic.claude-haiku-4-5-20251001-v1:0'],
      // 区切りが無い
      ['claude-haiku', 'claude-haiku'],
    ])('%s と %s は対応していない', (profileId, foundationModelId) => {
      expect(() =>
        assertInferenceProfileMatchesFoundationModel(profileId, foundationModelId),
      ).toThrow(/対応していない/);
    });
  });

  // Issue #86: Application Signals の計装
  describe('Application Signals の計装', () => {
    const targets = ['dev-sakekasu-ocr-analyzer', 'dev-sakekasu-presigned-url'];

    /**
     * 期待するレイヤーの ARN。
     *
     * 実装から import せず値を書き写している。実装と同じ定数を参照すると
     * 「実装を変えたらテストも一緒に変わる」ので検査にならない
     * （`lambda-config.test.ts` と同じ考え方）。
     *
     * アカウント ID とバージョンまで固定するのは、レイヤーが**アプリと同じ
     * 実行環境で、アプリコードより先に動く**ため。差し替わると実行ロールの
     * 認証情報にも環境変数にも届く。名前の部分一致だけで見ていると、
     * 提供元アカウントの取り違えを緑のまま通してしまう（PR #153 のレビュー指摘）。
     *
     * 上げるときは ARN を書き換えるだけで済ませず、中身を展開して
     * `otel-instrument` があることを確かめること（手順は docs/application-signals.md）
     */
    const EXPECTED_LAYER_ARN =
      'arn:aws:lambda:ap-northeast-1:615299751070:layer:AWSOpenTelemetryDistroJs:15';

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
    // 1 回の呼び出しが Bedrock の課金につながるので、暴走したときの費用に
    // 天井を置く。アカウント上限を上げたことで設定できるようになった（Issue #82 の続き）
    it.each([
      ['dev-sakekasu-ocr-analyzer', 20],
      ['dev-sakekasu-tasting-note', 5],
    ])('%s は同時実行の上限を切っている', (functionName, reserved) => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: functionName,
        ReservedConcurrentExecutions: reserved,
      });
    });

    // 予約は上限と下限を兼ねる。伸びてほしい関数に付けると、
    // 未予約プールを使えなくなって逆に頭打ちになる
    it('画像 URL の発行には上限を切らない', () => {
      const functions = template.findResources('AWS::Lambda::Function', {
        Properties: { FunctionName: 'dev-sakekasu-presigned-url' },
      });
      const [presigned] = Object.values(functions);

      expect(presigned.Properties.ReservedConcurrentExecutions).toBeUndefined();
    });

    // 予約の合計はアカウント単位で効くため、1 スタックだけ見ても足りない。
    // 全スタックを合成する lambda-config.test.ts 側で見張っている

    // Node.js 向けの AWS 製レイヤーは2種類あり、起動ラッパーの名前が違う。
    // - AWSOpenTelemetryDistroJs（Application Signals 用）→ /opt/otel-instrument
    // - aws-otel-nodejs-amd64-ver-*（汎用 ADOT）        → /opt/otel-handler
    // 前回は後者のレイヤーに前者のラッパー名を組み合わせて落ちた。
    // ラッパー名だけを見ても正誤は決まらないので、レイヤーとの組み合わせで固定する。
    it.each(targets)('%s は Application Signals のレイヤーとラッパーが揃っている', (functionName) => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: functionName,
        // 提供元アカウントとバージョンまで込みで固定する
        Layers: [EXPECTED_LAYER_ARN],
        Environment: {
          Variables: Match.objectLike({
            AWS_LAMBDA_EXEC_WRAPPER: '/opt/otel-instrument',
          }),
        },
      });
    });

    // レイヤーには Bedrock のリクエスト本文をスパンに載せる仕組みがあり、
    // `AGENT_OBSERVABILITY_ENABLED=true` が入ると既定で有効になる。OCR の
    // 本文には base64 の画像が入っているので、明示的に切っておく。
    // 文書だけの取り決めにすると、環境変数を足す人が読んでいることに賭けることになる
    it.each(targets)('%s は GenAI の本文キャプチャを明示的に切っている', (functionName) => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: functionName,
        Environment: {
          Variables: Match.objectLike({
            OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'false',
          }),
        },
      });
    });

    it.each(targets)('%s の実行ロールに Application Signals の権限が付いている', (functionName) => {
      // レイヤーが起動してもこの権限が無いとテレメトリが送れず、
      // 「動いているのに何も出ない」状態になる。
      //
      // ロールは関数から引く。AWS::IAM::Role を型だけで探すと、どれか1つの
      // ロールに付いていれば通ってしまい、関数を増やしたときの付け忘れを
      // 素通りさせる
      const role = executionRoleOf(template, functionName);

      expect(
        JSON.stringify(role.Properties?.ManagedPolicyArns ?? []),
        `${functionName} の実行ロールに Application Signals の管理ポリシーが無い`,
      ).toContain('CloudWatchLambdaApplicationSignalsExecutionRolePolicy');
    });

    // 外から持ってきたロールに addManagedPolicy を打つと、CDK は**何も言わずに
    // 捨てる**（実測で確認）。合成は成功し、レイヤーもラッパーも載るので、
    // 関数は起動するのにテレメトリだけ出ない。3つの壊れ方のうち一番見つけにくい
    // ものなので、合成時に落ちることを固定する（PR #153 のレビュー指摘）
    it('外部から持ってきたロールの関数には計装を入れさせない', () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, 'RoleGuardStack', {
        env: { account: '111122223333', region: 'ap-northeast-1' },
      });
      const fn = new NodejsFunction(stack, 'ImportedRoleFunction', {
        runtime: Runtime.NODEJS_22_X,
        entry: path.join(
          path.dirname(url.fileURLToPath(import.meta.url)),
          '../lambda/presigned-url/index.ts',
        ),
        handler: 'handler',
        role: cdk.aws_iam.Role.fromRoleArn(
          stack,
          'ExternalRole',
          'arn:aws:iam::111122223333:role/external',
        ),
      });

      expect(() => enableApplicationSignals(fn, 'ImportedRole')).toThrow(
        /テレメトリだけ出ない/,
      );

      // 落ちるだけでなく、関数が手つかずで残ることまで見る（PR #153 のレビュー指摘）。
      //
      // construct への変更は取り消せないので、検査より先にレイヤーや環境変数を
      // 足していると、例外を握り潰した呼び出し元に「レイヤーは載っているのに
      // 権限だけ無い」関数が残る。それは計装が壊れた状態そのもの
      const guardTemplate = Template.fromStack(stack);
      const [synthesized] = Object.values(
        guardTemplate.findResources('AWS::Lambda::Function'),
      );

      expect(synthesized.Properties?.Layers ?? [], 'レイヤーが載ってしまっている').toHaveLength(
        0,
      );
      expect(
        synthesized.Properties?.Environment?.Variables?.AWS_LAMBDA_EXEC_WRAPPER,
        '起動ラッパーが設定されてしまっている',
      ).toBeUndefined();
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
