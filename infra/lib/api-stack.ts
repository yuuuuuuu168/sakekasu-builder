import * as cdk from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as logs from 'aws-cdk-lib/aws-logs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Architecture, LayerVersion, Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import * as path from 'node:path';
import * as url from 'node:url';
import type { Construct } from 'constructs';
import { lambdaLogGroup } from './log-retention.js';
import {
  MAX_IMAGES_PER_RECORD,
  TEMP_LOCATION,
  TEMP_TAG_KEY,
  TEMP_TAG_VALUE,
} from './image-constants.js';
import { applyRoleBoundary } from './role-boundary.js';
import type { SharedAuth } from './shared-auth.js';

/**
 * Application Signals 用の OpenTelemetry レイヤー（Issue #86）。
 *
 * Node.js 向けの AWS 製レイヤーは2種類あり、**起動ラッパーの名前が違う**。
 *
 * | レイヤー | ラッパー |
 * |---|---|
 * | AWSOpenTelemetryDistroJs（Application Signals 用・これ） | /opt/otel-instrument |
 * | aws-otel-nodejs-amd64-ver-*（汎用 ADOT） | /opt/otel-handler |
 *
 * PR #110 で本番を止めたのは、**汎用 ADOT のレイヤーに Application Signals 用の
 * ラッパー名を組み合わせた**ため。存在しないパスを指定するとラッパーの解決に
 * 失敗した時点で関数が Runtime.ExitError で落ち、画像アップロードが全滅した。
 * 当時は「/opt/otel-instrument は Python 用」と結論づけたが、それは誤り。
 * Application Signals 用レイヤーでは Node.js でもこの名前が正しい。
 *
 * v15 の中身は実機で展開して確認済み（2026-08-10）。
 * - otel-instrument が存在する（otel-handler は無い）
 * - CompatibleRuntimes に nodejs22.x を含む / x86_64・arm64 の両対応
 * - ESM 判定に入ると Node 20+ では `--import /opt/wrapper.mjs` を使う。
 *   これは module.register() による選択的フックで、レイヤー自身のコメントに
 *   「バンドルされたアプリコードの ESM ライブバインディングを壊す
 *   --experimental-loader を避けるため」と書かれている。本スタックの関数は
 *   esbuild で index.mjs を吐くので、この経路に入る
 *
 * 更新するときは ARN を差し替えるだけで済ませず、中身を展開して
 * otel-instrument があることを確かめること。ARN が実在することの確認は
 * 中身の検証ではない。
 */
const APPLICATION_SIGNALS_NODEJS_LAYER_ARN =
  'arn:aws:lambda:ap-northeast-1:615299751070:layer:AWSOpenTelemetryDistroJs:15';

/**
 * OCR が呼ぶ Bedrock のモデル（Issue #82）。
 *
 * 先頭の `jp.` はクロスリージョン推論プロファイルの印で、リクエストは
 * プロファイルが束ねるリージョンのどれかへ振られる。InvokeModel の認可は
 * **プロファイル本体と振り先の foundation-model の両方**を見るため、
 * プロファイルの ARN だけを許可すると AccessDeniedException で OCR が止まる。
 *
 * 振り先は実機で取得した（2026-08-10、アカウント 232791540685 / ap-northeast-1）。
 *
 * ```
 * aws bedrock list-inference-profiles --region ap-northeast-1 \
 *   --query "inferenceProfileSummaries[?inferenceProfileId=='jp.anthropic.claude-haiku-4-5-20251001-v1:0'].models"
 * → arn:aws:bedrock:ap-northeast-3::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0
 *   arn:aws:bedrock:ap-northeast-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0
 * ```
 *
 * 「両方要る」は使い捨てロールに同じポリシーだけを付けて実測した（2026-08-10）。
 * プロファイルの ARN だけにすると 6/6 が下のエラーで落ちる。
 *
 * ```
 * AccessDeniedException: ... is not authorized to perform: bedrock:InvokeModel
 * on resource: arn:aws:bedrock:ap-northeast-3::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0
 * ```
 *
 * 3つ揃えたポリシーでは 6/6 成功する。なお put-role-policy の直後は前の
 * ポリシーで通ってしまうことがある（IAM は結果整合）。少し置いてから見ること。
 *
 * モデルを差し替えるときは ID を書き換えるだけで済ませず、同じコマンドで
 * 振り先リージョンを取り直すこと。振り先が1つでも欠けると、その振り先に
 * 当たったリクエストだけが落ちる（毎回は落ちない）。ただし気づけないわけでは
 * なく、OCR のログに欠けている ARN 名指しの AccessDeniedException が出る。
 * Application Signals の計装（Issue #86）が入っているのでトレースにも残る。
 */
const BEDROCK_MODEL_ID = 'jp.anthropic.claude-haiku-4-5-20251001-v1:0';
/**
 * 上の推論プロファイルが指す基盤モデル。
 *
 * プロファイルIDから接頭辞を落としたものだが、`BEDROCK_MODEL_ID.replace(/^jp\./, '')`
 * のように正規表現で導出しない。接頭辞は `jp.` だけではなく（`us.` `eu.` `apac.`
 * `global.` などがあり、今後も増える）、想定外の接頭辞を渡されたときに正規表現は
 * 例外を出さずに接頭辞つきのまま通してしまう。結果、実在しない
 * `foundation-model/us.anthropic...` のような ARN を黙って作り、デプロイは成功する
 * のに全リクエストが AccessDeniedException になる。
 *
 * 2つを別々に持ち、対応が崩れていないかは下の synth 時チェックで見る。
 */
const BEDROCK_FOUNDATION_MODEL_ID = 'anthropic.claude-haiku-4-5-20251001-v1:0';
/** 上の推論プロファイルの振り先リージョン */
const BEDROCK_INFERENCE_REGIONS = ['ap-northeast-1', 'ap-northeast-3'];

/**
 * OCR 解析 Lambda に取り置く同時実行数。
 *
 * 1 回の呼び出しが Bedrock の課金につながるので、暴走したときの費用に
 * 天井を置く。予約は上限と下限を兼ねるため、絞りすぎると正常な利用まで
 * 弾いてしまう。1 記録あたり最大 5 枚・実績は週 58 回なので 20 で足りる。
 *
 * 予約はアカウント単位で積み上がる。このスタック以外にも
 * devops-agent-stack.ts が 2 を取っており、現時点の合計は 22。
 * アカウントの同時実行上限（1000）から予約の合計を引いた残りは 100 以上を
 * 保つ必要があり、合計は __tests__/lambda-config.test.ts で見張っている
 */
const OCR_RESERVED_CONCURRENCY = 20;

/**
 * テイスティングノート生成 Lambda に取り置く同時実行数。
 *
 * OCR と同じく1回の呼び出しが Bedrock の課金につながるので天井を置く。
 * OCR より小さいのは、送るのが銘柄名の文字列だけで所要時間が短く、
 * 既存記録への一括追記も画面側で1件ずつ直列に呼ぶため。
 *
 * 予約はアカウント単位で積み上がる。合計は __tests__/lambda-config.test.ts で
 * 見張っている（足すときはそちらの EXPECTED_RESERVATIONS も直すこと）
 */
const TASTING_NOTE_RESERVED_CONCURRENCY = 5;

/**
 * Application Signals の計装を関数に入れる（Issue #86）。
 *
 * レイヤー・起動ラッパー・IAM ポリシーの3点は**セットでしか意味を持たない**。
 * 欠けたときの壊れ方がそれぞれ違い、しかも1つは起動不能になる。
 *
 * | 欠けるもの | 起きること |
 * |---|---|
 * | レイヤー | ラッパーの解決に失敗し `Runtime.ExitError`。関数が 100% 落ちる |
 * | ラッパー | レイヤーは載るが計装が始まらない。何も出ない |
 * | IAM | 計装は動くがテレメトリを送れない。やはり何も出ない |
 *
 * 呼び出し側で3行を並べる形にしていると、関数を増やすときに1つ書き落とす。
 * PR #110 で画像アップロードを全滅させたのは1つ目の組み合わせなので、
 * 3点を1か所に閉じて、関数ごとに書き写さなくて済むようにする。
 *
 * export しているのはテストから直接呼ぶため。スタック経由では通らない分岐
 * （外部ロールを渡した場合）を確かめる手段が他に無い。
 *
 * @param fn 計装する関数
 * @param id レイヤー参照の construct ID に使う接頭辞。関数ごとに一意にする
 */
export function enableApplicationSignals(fn: NodejsFunction, id: string): void {
  // 何かを足す前にロールの素性を確かめる（PR #153 のレビュー指摘）。
  //
  // `fn.role` が undefined になることは無い（NodejsFunction は渡されなければ
  // ロールを作る。実測で確認済み）が、`Role.fromRoleArn` で外から持ってきた
  // ロールを渡された場合は `addManagedPolicy` が**何も言わずに捨てられる**。
  // 合成は成功し、レイヤーもラッパーも載るので、関数は起動するのに
  // テレメトリだけ出ない。3つの壊れ方のうち一番見つけにくいものなので、
  // 合成時に落とす。
  //
  // **検査を先頭に置くこと**に意味がある。construct への変更は取り消せない
  // ので、レイヤーや環境変数を足したあとで落とすと、例外を握り潰した呼び出し元に
  // 「レイヤーは載っているのに権限だけ無い」半端な関数が残る。ここで返れば
  // 関数は手つかずのまま。
  //
  // いまの2つの呼び出し元はどちらもロールを渡していないため、この分岐には
  // 入らない。将来ロールを外から渡す関数へ広げたときに気づけるようにしておく
  if (!cdk.aws_iam.Role.isRole(fn.role)) {
    throw new Error(
      `${id}: 実行ロールがこのスタックで作られたものではないため、Application Signals の` +
        '管理ポリシーを貼れない。外部のロールに addManagedPolicy は黙って捨てられ、' +
        '関数は起動するのにテレメトリだけ出ない状態になる',
    );
  }

  fn.addLayers(
    LayerVersion.fromLayerVersionArn(
      fn,
      `${id}ApplicationSignalsLayer`,
      APPLICATION_SIGNALS_NODEJS_LAYER_ARN,
    ),
  );
  // レイヤー v15 に実在するラッパー。汎用 ADOT の /opt/otel-handler ではない
  fn.addEnvironment('AWS_LAMBDA_EXEC_WRAPPER', '/opt/otel-instrument');
  // Bedrock のリクエスト本文をスパンに載せない（PR #153 のレビュー指摘）。
  //
  // レイヤーには本文キャプチャの仕組みがあり、`AGENT_OBSERVABILITY_ENABLED=true`
  // を入れると既定で有効になる。OCR の本文には base64 の画像（1枚あたり最大
  // 3.75MB）が入っているので、有効になるとそれがスパン属性として
  // `aws/spans` に流れ込む。
  //
  // いまこのアプリのどこにも `AGENT_OBSERVABILITY_ENABLED` は無い。ただし
  // ソムリエ側の GenAI Observability を広げるときに入れる可能性があり、
  // そのときは「入れる人が docs を読んでいること」だけが歯止めになる。
  // 明示的に false を置いておけば、その順番に関係なく載らない。
  //
  // Bedrock を呼ばない関数（presigned-url）では効き目が無いが、害も無い。
  // 関数ごとに付け外しすると、次に足す関数で判断をやり直すことになる
  fn.addEnvironment('OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT', 'false');
  // テレメトリを書くための権限。中身は以下の2文だけ（v1、2024-10-16 以降変更なし）。
  //
  //   xray:PutTraceSegments                                  → Resource: *
  //   logs:CreateLogGroup / CreateLogStream / PutLogEvents   → /aws/application-signals/data
  //
  // どちらも aws:ResourceAccount = ${aws:PrincipalAccount} の条件付きで自アカウントに閉じる。
  //
  // このポリシーが cloudwatch:PutMetricData を無制限に与える、という指摘が
  // レビューで2度出ているが、PutMetricData は含まれていない。監視スタックが
  // namespace 条件を付けているのと比べて緩い、という比較も対象が無いため成立しない。
  //
  // アプリのロールには Permissions Boundary が付く（Issue #150）。境界が
  // 外しているのは iam / sts / organizations / account だけなので、
  // xray と logs はどちらも天井の内側にある。
  // https://docs.aws.amazon.com/aws-managed-policy/latest/reference/CloudWatchLambdaApplicationSignalsExecutionRolePolicy.html
  //
  // ロールが CDK 管理のものであることは先頭で確かめてある
  fn.role.addManagedPolicy(
    cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
      'CloudWatchLambdaApplicationSignalsExecutionRolePolicy',
    ),
  );
}

/**
 * 推論プロファイルIDと基盤モデルIDの対応を検査する。
 *
 * システム定義の推論プロファイルIDは「<接頭辞>.<基盤モデルID>」の形をしていて、
 * 接頭辞はちょうど1区切りぶん（`jp.` `us.` `apac.` `global.` など）。よって
 * 「先頭の1区切りを落としたもの」と完全一致するかで見る。
 *
 * 後方一致で見ると足りない。`anthropic.` まで削りすぎた値も後方一致は通ってしまい、
 * 実在しない `foundation-model/claude-haiku-...` を許可した状態でデプロイが成功して、
 * 本番の OCR だけが AccessDeniedException で止まる。
 *
 * 接頭辞の無い素の基盤モデルIDを渡した場合も落とす。その場合は推論プロファイルでは
 * ないので、そもそも組み立てるべき ARN の形が違う。
 */
export function assertInferenceProfileMatchesFoundationModel(
  profileId: string,
  foundationModelId: string,
): void {
  const stripped = profileId.replace(/^[^.]+\./, '');
  if (stripped === profileId || stripped !== foundationModelId) {
    throw new Error(
      `推論プロファイルID (${profileId}) と基盤モデルID (${foundationModelId}) が対応していない。` +
        `期待する基盤モデルIDは "${stripped}"。` +
        '推論プロファイルIDは「<接頭辞>.<基盤モデルID>」の形になる',
    );
  }
}

// 片方だけ書き換えたら synth の時点で落とす。デプロイまで通してしまうと、
// 気づくのは本番の OCR が AccessDeniedException で止まったときになる
assertInferenceProfileMatchesFoundationModel(BEDROCK_MODEL_ID, BEDROCK_FOUNDATION_MODEL_ID);

export interface ApiStackProps extends cdk.StackProps {
  /** 環境名（dev, staging, prod） */
  envName: string;
  /**
   * 共通ログインの接続先（cdk.json の context `sharedAuth`）。
   *
   * 以前はアプリ専用の旧プール（AuthStack。いまは外した）の UserPool を
   * オブジェクト参照で受け取っていた。共通ログインは別リポジトリのスタックなので、
   * ID だけを受け取ってここで参照を組み立てる
   */
  sharedAuth: SharedAuth;
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
  /** テイスティングノート生成 Lambda（監視スタックから参照する） */
  public readonly tastingNoteFunction: NodejsFunction;
  /**
   * 画像削除失敗のメトリクスフィルター。
   * アラーム自体は監視スタック側で作る（通知先の SNS を参照すると
   * このスタックが監視スタックに依存し、循環参照になるため）
   */
  public readonly imageDeleteFailMetricFilter: logs.MetricFilter;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // このスタックが作るロールはすべて Permissions Boundary の内側に置く
    // （Issue #150）。cdkd のデプロイロールは境界の付いたロールしか
    // 作り替えられない条件になっているため、外すとデプロイが止まる。
    // 詳細は lib/role-boundary.ts
    applyRoleBoundary(this);

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
            // 共通ログインのユーザープール（4 アプリで共有）。
            userPool: cognito.UserPool.fromUserPoolId(
              this,
              'SharedUserPool',
              props.sharedAuth.userPoolId,
            ),
            // 共有プールには他のアプリのクライアントもいる。同じ利用者でも
            // 他のアプリ向けに出たトークンでは記録を読めないよう、builder の
            // クライアントに限る（AppSync はアクセストークンの client_id、
            // ID トークンの aud をこの正規表現と照合する）
            appIdClientRegex: `^${props.sharedAuth.clientId}$`,
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
      lifecycleRules: [
        {
          // OCR の事前アップロードは記録の作成前に走るため、フォームを保存せずに
          // 離れたキーがどこからも参照されないまま残る。タブを閉じる経路まで
          // 確実に捕まえるのは無理なので、置き場ごと期限付きにする（Issue #140）
          id: 'expire-temporary-uploads',
          enabled: true,
          // プレフィックスは前方一致しか使えず、`{sub}` が利用者ごとに変わるため
          // タグで対象を絞る。付与は presigned-url Lambda 側
          tagFilters: { [TEMP_TAG_KEY]: TEMP_TAG_VALUE },
          expiration: cdk.Duration.days(1),
          // バージョニングが有効なので、現行バージョンを消しても旧版が残る。
          // 併せて消さないと容量が減らない
          noncurrentVersionExpiration: cdk.Duration.days(1),
        },
        {
          // 記録の画像を消しても、バージョン ID を付けない削除は削除マーカーを
          // 置くだけで、実体は旧バージョンとして残る。同じキーへの上書きも
          // 旧版を積み上げる。期限が無いと、消したはずの写真がいつまでも残り
          // 容量も減らない（Issue #217）。
          //
          // 30 日は誤削除・誤上書きから戻す猶予。バージョニングを有効にした目的は
          // それなので、期限はその分だけ残す
          id: 'expire-noncurrent-versions',
          enabled: true,
          noncurrentVersionExpiration: cdk.Duration.days(30),
          // 旧版が消えたあとに残る、何も指さない削除マーカーも片付ける
          expiredObjectDeleteMarker: true,
        },
      ],
      cors: [
        {
          allowedOrigins: [
            // 画面は sake. だけで配っている。apex と www は sake. へ転送するだけなので
            // ここに要らない（docs/sake-subdomain.md）
            'https://sake.sakekasu-builder.com',
            'http://localhost:5173',
          ],
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
    });

    // Presigned URL 生成 Lambda 関数
    const presignedUrlFunctionName = `${props.envName}-sakekasu-presigned-url`;
    this.presignedUrlFunction = new NodejsFunction(
      this,
      'PresignedUrlFunction',
      {
        functionName: presignedUrlFunctionName,
        runtime: Runtime.NODEJS_22_X,
        logGroup: lambdaLogGroup(this, 'PresignedUrlLogGroup', presignedUrlFunctionName),
        entry: path.join(
          path.dirname(url.fileURLToPath(import.meta.url)),
          '../lambda/presigned-url/index.ts',
        ),
        handler: 'handler',
        // 既定値の変化でレイヤーと噛み合わなくなるのを防ぐため明示する。
        // Application Signals のレイヤーは arm64 にも対応しているので、
        // 費用を詰めるなら両方まとめて arm64 へ寄せる余地がある（別件）
        architecture: Architecture.X86_64,
        // Application Signals と一緒に使うと、リクエスト単位で
        // どこに時間がかかったかまで辿れる
        tracing: Tracing.ACTIVE,
        // 既定の 128MB から上げている（Issue #86）。
        //
        // **理由は余裕が無かったこと。** 計装を入れた直後の実測で Max Memory Used が
        // 100〜103MB から 120MB へ増え、128MB の枠に対して残り 8MB になった。
        // 超えると invocation ごと OOM で落ちる。落ちる先が画像アップロードの
        // 入口なので、いちばん困る場所。512MB では 155MB（30%）に収まっている。
        //
        // なおこの増分は固定的なオーバーヘッドで、画像の枚数では増えない
        // （URL に署名するだけで、copyImages も S3 側でコピーするためバイト列が
        // Lambda を通らない）。実測でも複数の invocation が同じ値で揃う。
        // 青天井ではないが、8MB は薄すぎた。
        //
        // **コールドスタートは上げても縮まない。** 512MB にした後の実測は
        // 1145ms → 1202ms で、CPU を4倍にしても横ばいだった。レイヤーぶんの
        // 初期化コストは OCR（512MB）で +603ms、この関数で 128MB のとき +707ms、
        // 512MB で +764ms と、メモリ配分に関係なくほぼ一定になる。
        // **メモリを上げる理由にコールドスタートを数えないこと。**
        //
        // 縮むのは実行時間のほう。ウォームな呼び出しが 50〜78ms から 6ms へ、
        // コールド時の1回目も 1070ms から 254ms へ落ちた。こちらは CPU に
        // 素直に比例する。結果としてコールドパス全体（init + 1回目）は
        // 2215ms → 1456ms になっている。
        //
        // 費用は判断材料に入れていない。ウォームな呼び出しは実行時間が縮むぶん
        // 安くなり、コールドスタートは init が縮まないぶん高くなる（GB-秒で 2.6倍）。
        // どちらもこの規模（月に数百リクエスト）では無料枠に対して誤差。
        //
        // 実測の値と取り方は docs/application-signals.md の「計装の代償」にある
        memorySize: 512,
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

    // Application Signals の計装（Issue #86）。
    //
    // OCR で先に入れて確かめたのと同じ組み合わせ（レイヤー v15 / Node.js 22 /
    // ESM バンドル / x86_64）なので、前回の未知だった部分はもう残っていない。
    //
    // ただしこちらは**同期の動線**で、コールドスタートがそのまま体感になる。
    // OCR（512MB）での実測は Init Duration が 638ms → 1241ms。この関数は
    // メモリが既定の 128MB でその分 CPU が少ないため、悪化幅はこれより
    // 大きくなりうる。悪くなっていたらメモリを増やして緩和する（判断材料は
    // docs/application-signals.md の計測手順）
    enableApplicationSignals(this.presignedUrlFunction, 'PresignedUrl');

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

    // getDownloadUrls クエリリゾルバー（一覧の画像 URL をまとめて取る）
    presignedUrlDataSource.createResolver('GetDownloadUrlsResolver', {
      typeName: 'Query',
      fieldName: 'getDownloadUrls',
    });

    // copyImages ミューテーションリゾルバー（在庫から飲むときの画像引き継ぎ）
    presignedUrlDataSource.createResolver('CopyImagesResolver', {
      typeName: 'Mutation',
      fieldName: 'copyImages',
    });

    // OCR Analyzer Lambda 関数
    const ocrAnalyzerFunctionName = `${props.envName}-sakekasu-ocr-analyzer`;
    this.ocrAnalyzerFunction = new NodejsFunction(this, 'OcrAnalyzerFunction', {
      functionName: ocrAnalyzerFunctionName,
      runtime: Runtime.NODEJS_22_X,
      logGroup: lambdaLogGroup(this, 'OcrAnalyzerLogGroup', ocrAnalyzerFunctionName),
      entry: path.join(
        path.dirname(url.fileURLToPath(import.meta.url)),
        '../lambda/ocr-analyzer/index.ts',
      ),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      architecture: Architecture.X86_64,
      tracing: Tracing.ACTIVE,
      // この関数だけ同時実行の上限を切っている。1 回の呼び出しが Bedrock の
      // 課金につながるため、暴走したときの費用に天井を置く。
      //
      // 予約は上限と下限を兼ねる。ここで確保した分は他の関数から使えなくなる
      // 代わりに、他が枠を食い尽くしても OCR は必ずこの数まで動く。
      // 実績は週 58 回・1 記録あたり最大 5 枚なので、同時 20 で足りる
      reservedConcurrentExecutions: OCR_RESERVED_CONCURRENCY,
      environment: {
        BUCKET_NAME: this.imageBucket.bucketName,
        BEDROCK_MODEL_ID,
      },
      bundling: {
        format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
        mainFields: ['module', 'main'],
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });

    // Application Signals の計装（Issue #86）。
    //
    // 2026-08-10 に OCR へ先に入れ、6日ぶん動かしてから presigned-url へ広げた。
    // 順に入れたのは、PR #110 で2関数へ同時に入れて両方止め、画像アップロードの
    // 動線ごと失ったため。OCR が落ちても記録の登録自体は通る（解析だけが失敗する）
    // ので、被害が動線を塞がない側から試している。
    enableApplicationSignals(this.ocrAnalyzerFunction, 'Ocr');

    // S3 読み取り権限
    this.imageBucket.grantRead(this.ocrAnalyzerFunction);

    // Bedrock InvokeModel 権限（Issue #82）。
    //
    // 以前は Resource が `*` で、この実行ロールを取れれば同一アカウントで
    // 有効化済みの全モデルを呼べた。OCR が使うのは1モデルだけなので、
    // 推論プロファイルとその振り先だけに絞る。
    //
    // foundation-model の ARN にアカウントIDが入らないのは仕様（AWS 側の
    // リソースのため）。プロファイル側はアカウント単位なので入る。
    this.ocrAnalyzerFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:${this.partition}:bedrock:${this.region}:${this.account}:inference-profile/${BEDROCK_MODEL_ID}`,
        ...BEDROCK_INFERENCE_REGIONS.map(
          (region) =>
            `arn:${this.partition}:bedrock:${region}::foundation-model/${BEDROCK_FOUNDATION_MODEL_ID}`,
        ),
      ],
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

    // テイスティングノート生成 Lambda。
    //
    // OCR と同じ Bedrock のモデルを呼ぶが、関数は分けている。OCR は画像を運ぶ
    // ので実行時間もメモリも一桁違い、同じ関数に相乗りさせると SLO の遅延が
    // どちらの話なのか読めなくなる。予約同時実行も、片方の暴走がもう片方を
    // 巻き込まない形にしたい
    // Web 検索（Tavily）の API キーを入れた Secrets Manager の名前。
    //
    // ソムリエが使っているものと同じ鍵を指す。同じ用途の鍵を2つ登録すると、
    // 手作業で入れ替えるときに片方だけ古いまま残る。値はリポジトリに置かず、
    // 渡すのは名前だけで、読む権限をこの1つに限って与える。
    //
    // 鍵が未登録の環境では検索は無効として動く（Lambda 側が空で返す）
    const tavilyApiKeySecretName = `${props.envName}-sakekasu/sommelier/tavily-api-key`;

    const tastingNoteFunctionName = `${props.envName}-sakekasu-tasting-note`;
    this.tastingNoteFunction = new NodejsFunction(this, 'TastingNoteFunction', {
      functionName: tastingNoteFunctionName,
      runtime: Runtime.NODEJS_22_X,
      logGroup: lambdaLogGroup(this, 'TastingNoteLogGroup', tastingNoteFunctionName),
      entry: path.join(
        path.dirname(url.fileURLToPath(import.meta.url)),
        '../lambda/tasting-note/index.ts',
      ),
      handler: 'handler',
      // 知らない銘柄では「学習知識で1回 → Web 検索 → 検索結果つきでもう1回」と
      // 三段になる。実測でモデルが1回 1〜3秒、検索は6秒で打ち切るので、
      // 一番遅い経路でも 15 秒には収まる。それでも足りなければ諦めて、
      // 登録そのものは通す（フロントは失敗しても記録の保存を止めない）
      timeout: cdk.Duration.seconds(25),
      memorySize: 256,
      architecture: Architecture.X86_64,
      tracing: Tracing.ACTIVE,
      reservedConcurrentExecutions: TASTING_NOTE_RESERVED_CONCURRENCY,
      environment: {
        BEDROCK_MODEL_ID,
        TAVILY_API_KEY_SECRET_ID: tavilyApiKeySecretName,
      },
      bundling: {
        format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
        mainFields: ['module', 'main'],
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });

    // Bedrock InvokeModel 権限。許可する ARN の考え方は OCR 側と同じ
    // （推論プロファイル本体と、その振り先の foundation-model の両方が要る）
    this.tastingNoteFunction.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:${this.partition}:bedrock:${this.region}:${this.account}:inference-profile/${BEDROCK_MODEL_ID}`,
          ...BEDROCK_INFERENCE_REGIONS.map(
            (region) =>
              `arn:${this.partition}:bedrock:${region}::foundation-model/${BEDROCK_FOUNDATION_MODEL_ID}`,
          ),
        ],
      }),
    );

    // Web 検索の API キーを読む権限。名前だけでは ARN が確定しないため、
    // 既存スタック（監視・DevOps Agent）と同じく `-*` で受ける
    this.tastingNoteFunction.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          this.formatArn({
            service: 'secretsmanager',
            resource: 'secret',
            resourceName: `${tavilyApiKeySecretName}-*`,
            arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
          }),
        ],
      }),
    );

    const tastingNoteDataSource = this.graphqlApi.addLambdaDataSource(
      'TastingNoteDataSource',
      this.tastingNoteFunction,
    );

    tastingNoteDataSource.createResolver('GenerateTastingNoteResolver', {
      typeName: 'Mutation',
      fieldName: 'generateTastingNote',
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

    /**
     * 画像キーを検証するリゾルバーコード片（create / update で共有）。
     *
     * 他人のキーを書いた記録を作れると、その記録を削除したときに削除
     * パイプラインが他人の画像を消してしまう。作成だけでなく更新でも要る
     * （登録後に画像を足せるようにしたため。Issue #142）。
     *
     * あわせて一時領域（{sub}/tmp/...）のキーも拒否する。あちらは
     * ライフサイクルで 1 日後に消えるため、記録に持たせると実体だけが
     * 消えて画像の出ない記録が残る。フロントは保存前に正式な場所へ
     * 複製しているが、API を直接叩けばその手順を飛ばせる（Issue #140）
     */
    const imageOwnershipGuard = `
  // 添付枚数の上限。copyImages にも同じ上限があるが、あちらは複製経路だけを
  // 見ている。API を直接叩いて任意の枚数を書き込まれると、getDownloadUrls の
  // 上限（100件）を超えた記録が開けなくなり、削除時の S3 呼び出しも青天井になる
  if (input.imageKeys && input.imageKeys.length > ${MAX_IMAGES_PER_RECORD}) {
    util.error('Invalid imageKeys: too many images', 'BadRequest');
  }

  // 空配列は素通りする。中身が無いのでループの検査は 1 度も走らないまま
  // imageKeys = [] が書き込まれ、記録から画像への参照だけが消えて
  // S3 の実体が誰からも辿れなくなる。画像を外す操作は今のところ無い
  if (input.imageKeys && input.imageKeys.length === 0) {
    util.error('Invalid imageKeys: must not be empty', 'BadRequest');
  }

  const prefix = ctx.identity.sub + '/';

  // 自分のキーか。null 要素で落ちないよう、値の有無もここで見る
  const isOwned = (key) => !!key && key.startsWith(prefix);

  // 一時領域のキーはそのまま記録に入れられない
  const rejectTemporary = (key) => {
    if (key.split('/')[1] === '${TEMP_LOCATION}') {
      util.error('Invalid imageKey: temporary keys cannot be stored in records', 'BadRequest');
    }
  };

  if (input.imageKey) {
    if (!isOwned(input.imageKey)) {
      util.error('Unauthorized: imageKey must belong to the requester', 'Unauthorized');
    }
    rejectTemporary(input.imageKey);
  }
  if (input.imageKeys) {
    for (const key of input.imageKeys) {
      if (!isOwned(key)) {
        util.error('Unauthorized: imageKeys must belong to the requester', 'Unauthorized');
      }
      rejectTemporary(key);
    }
  }
`;

    // create ミューテーション
    dataSource.createResolver(`Create${typeName}Resolver`, {
      typeName: 'Mutation',
      fieldName: `create${typeName}`,
      runtime: jsRuntime,
      code: appsync.Code.fromInline(`
export function request(ctx) {
  const now = util.time.nowISO8601();
  const input = ctx.args.input;

  // 画像キーは自分のものだけを受け付ける
${imageOwnershipGuard}
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

  // 画像キーは自分のものだけを受け付ける。
  // 登録後に画像を追加できるようにしたため、更新経路でも検証する（Issue #142）
${imageOwnershipGuard}
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
