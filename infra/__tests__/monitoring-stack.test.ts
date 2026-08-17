import { Template, Match } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack.js';
import { ApiStack } from '../lib/api-stack.js';
import { MonitoringStack } from '../lib/monitoring-stack.js';

const TEST_ACCOUNT = '111122223333';
const TEST_REGION = 'ap-northeast-1';

const RUNTIME_ARN =
  'arn:aws:bedrock-agentcore:ap-northeast-1:111122223333:runtime/sommelier_test-ABC123';

/** Fn::Join の静的な文字列部分だけを繋ぐ（トークンは無視する） */
function flattenJoin(value: unknown): string {
  if (typeof value === 'string') return value;
  const join = (value as { 'Fn::Join'?: [string, unknown[]] })?.['Fn::Join'];
  if (!join) return JSON.stringify(value);
  const [separator, parts] = join;
  return parts.map((part) => (typeof part === 'string' ? part : '')).join(separator);
}

/**
 * トピックポリシーから、CloudWatch アラームの publish を許可している文を拾う。
 *
 * `Sid` では探さない。`Sid` を変えただけで「文が無い」と誤判定してしまい、
 * 本題と関係ない理由でテストが落ちるため。効くのは principal と action なので、
 * ポリシーの評価と同じ見方で拾う。
 */
function cloudwatchPublishStatements(template: Template): Record<string, unknown>[] {
  const policies = template.findResources('AWS::SNS::TopicPolicy');
  return Object.values(policies)
    .flatMap((p) => (p.Properties?.PolicyDocument?.Statement ?? []) as Record<string, unknown>[])
    .filter((st) => {
      const principal = (st.Principal as { Service?: string | string[] })?.Service;
      const services = Array.isArray(principal) ? principal : [principal];
      const actions = Array.isArray(st.Action) ? st.Action : [st.Action];
      return (
        st.Effect === 'Allow' &&
        services.includes('cloudwatch.amazonaws.com') &&
        actions.includes('sns:Publish')
      );
    });
}

function synth() {
  const app = new cdk.App();
  const env = { account: TEST_ACCOUNT, region: TEST_REGION };

  const authStack = new AuthStack(app, 'TestAuth', { envName: 'dev', env });
  const apiStack = new ApiStack(app, 'TestApi', {
    envName: 'dev',
    userPool: authStack.userPool,
    env,
  });
  const monitoringStack = new MonitoringStack(app, 'TestMonitoring', {
    envName: 'dev',
    graphqlApi: apiStack.graphqlApi,
    tables: [apiStack.purchaseTable, apiStack.drinkingTable],
    functions: [apiStack.presignedUrlFunction, apiStack.ocrAnalyzerFunction],
    ocrFunction: apiStack.ocrAnalyzerFunction,
    imageDeleteFailMetricFilter: apiStack.imageDeleteFailMetricFilter,
    signupNotifyFailMetricFilter: authStack.signupNotifyFailMetricFilter,
    sommelierRuntimeArn: RUNTIME_ARN,
    siteUrl: 'https://example.com',
    userPoolId: 'ap-northeast-1_TEST',
    canaryUserPoolClientId: 'canaryclientid',
    env,
  });

  return {
    template: Template.fromStack(monitoringStack),
    authTemplate: Template.fromStack(authStack),
  };
}

describe('MonitoringStack', () => {
  let template: Template;
  let authTemplate: Template;

  beforeAll(() => {
    const result = synth();
    template = result.template;
    authTemplate = result.authTemplate;
  });

  it('アラートを流す SNS トピックがある', () => {
    template.hasResourceProperties('AWS::SNS::Topic', {
      TopicName: 'dev-sakekasu-alerts',
    });
  });

  /**
   * トピックポリシーに明示的な文を1つでも置くと、SNS が暗黙に持っている
   * 「所有アカウントからの publish を許可する」既定ポリシーが丸ごと消える。
   * AwsHealthRule が events.amazonaws.com の文を作るため、この置き換えは必ず起きる。
   *
   * 実際に一度これで壊れた。全アラームが鳴っても Slack に何も届かず、
   * EventBridge 経由の AWS Health 通知だけが生きていたので気づけなかった。
   * アラーム経路が無言で死ぬ壊れ方なので、テストで固定する。
   */
  it('トピックポリシーが CloudWatch アラームからの publish を許可している', () => {
    expect(cloudwatchPublishStatements(template)).toHaveLength(1);
  });

  /**
   * 条件はキー名だけでなく、演算子と値まで見る。
   *
   * キー名しか見ないと、次のどれも素通りしてしまう。
   *
   * - `aws:SourceAccount` が `*`（どのアカウントからでも publish できる）
   * - 値が空文字（条件が実質無い）
   * - `aws:SourceArn` を `ArnLike` ではなく `StringEquals` で書く
   *
   * 最後のものが特に厄介で、末尾の `*` がワイルドカードではなくただの文字に
   * なるため、どのアラームにも一致せず配信が止まる。権限が無いのと同じ
   * 「鳴っているのに届かない」状態、つまりこのテストが防ぎたい壊れ方そのもの。
   *
   * 逆に条件を足しすぎても届かなくなるので、過不足なく一致することを見る。
   * ここを変えるときは、そのキーを CloudWatch が本当に渡すのかを確認すること。
   */
  it('CloudWatch への許可が、届く形の条件で絞られている', () => {
    const [statement] = cloudwatchPublishStatements(template);
    expect(statement).toBeDefined();

    expect(statement.Condition).toEqual({
      StringEquals: { 'aws:SourceAccount': TEST_ACCOUNT },
      ArnLike: {
        'aws:SourceArn': `arn:aws:cloudwatch:${TEST_REGION}:${TEST_ACCOUNT}:alarm:*`,
      },
    });
  });

  /**
   * 上の2つは、アラームが本当にこのトピックへ飛ぶ場合にだけ意味がある。
   * 宛先が別トピックに差し替わったら、許可を足しても届かない。
   */
  it('アラームの通知先がそのトピックである', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    const alarmList = Object.values(alarms);
    expect(alarmList.length).toBeGreaterThan(0);

    for (const alarm of alarmList) {
      expect(JSON.stringify(alarm.Properties?.AlarmActions)).toContain('AlertTopic');
    }
  });

  it('Slack 通知 Lambda がトピックを購読している', () => {
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'lambda',
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'dev-sakekasu-slack-notifier',
    });
  });

  it('Webhook URL はコードに持たず SSM パラメータ名だけを渡す', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'dev-sakekasu-slack-notifier',
      Environment: {
        Variables: {
          WEBHOOK_PARAMETER_NAME: '/dev-sakekasu/monitoring/slack-webhook-url',
        },
      },
    });
  });

  it('Slack 通知 Lambda の SSM 参照は該当パラメータだけに絞る', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ssm:GetParameter',
            Resource:
              'arn:aws:ssm:ap-northeast-1:111122223333:parameter/dev-sakekasu/monitoring/slack-webhook-url',
          }),
        ]),
      },
    });
  });

  // 今回の障害を検知できる本命のアラーム
  it('ソムリエの認証拒否を例外の種類ごとに監視する', () => {
    for (const exceptionType of [
      'UnauthorizedInboundTokenException',
      'InvalidInboundTokenException',
    ]) {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: `dev-sakekasu-sommelier-auth-failure-${exceptionType}`,
        Namespace: 'AWS/Bedrock-AgentCore',
        MetricName: 'InboundAuthorizationFailure',
        Dimensions: Match.arrayWith([
          { Name: 'ExceptionType', Value: exceptionType },
          { Name: 'ResourceId', Value: RUNTIME_ARN },
        ]),
      });
    }
  });

  it('AI 機能（ソムリエ・OCR）のエラーとスロットルを監視する', () => {
    for (const alarmName of [
      'dev-sakekasu-sommelier-system-errors',
      'dev-sakekasu-sommelier-throttles',
      'dev-sakekasu-ocr-errors',
      'dev-sakekasu-ocr-throttles',
    ]) {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', { AlarmName: alarmName });
    }
  });

  it('サービス正常性（AppSync・DynamoDB）を監視する', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'dev-sakekasu-appsync-5xx',
      Namespace: 'AWS/AppSync',
      MetricName: '5XXError',
    });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'AWS/DynamoDB',
      MetricName: 'ThrottledRequests',
    });
  });

  // 通知経路そのものが壊れると誰も気づけない
  it('Slack 通知 Lambda の失敗も監視する', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'dev-sakekasu-slack-notifier-failure',
    });
  });

  // 以前は ApiStack にあり通知先が無かった
  it('画像削除失敗アラームを引き継ぎ、通知先を持たせる', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'dev-sakekasu-image-delete-fail',
      MetricName: 'ImageDeleteFailCount',
    });
  });

  // Issue #66: 通知 Lambda は throw しないため、失敗ログから起こしたメトリクスで見る
  it('新規登録通知の失敗を監視する', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'dev-sakekasu-signup-notify-fail',
      MetricName: 'SignupNotifyFailCount',
    });
  });

  it('すべてのアラームが発報と復旧の両方を通知する', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    expect(Object.keys(alarms).length).toBeGreaterThan(0);

    for (const [logicalId, alarm] of Object.entries(alarms)) {
      expect(alarm.Properties.AlarmActions, `${logicalId} に発報通知が無い`).toBeDefined();
      expect(alarm.Properties.OKActions, `${logicalId} に復旧通知が無い`).toBeDefined();
    }
  });

  it('利用が無い時間帯に鳴らさない（欠損を異常扱いするのは意図したものだけ）', () => {
    // 欠損に意味がある指標は個別に扱う。
    // - カナリア: 間隔が長く、空白を「異常なし」と扱うと復旧を誤検知する
    // - 実行回数: 記録が無い＝動いていないので、欠損そのものが異常
    // - SLO の達成率: 30日の rolling で動きが遅い。値が出なくなったときに
    //   「異常なし」と扱うと、未達のまま復旧したことになってしまう（カナリアと同じ理由）
    const exceptions = new Set([
      'dev-sakekasu-sommelier-canary',
      'dev-sakekasu-watcher-silent-health-check',
      'dev-sakekasu-watcher-silent-sommelier-canary',
      'dev-sakekasu-ocr-slo-availability',
      'dev-sakekasu-ocr-slo-latency',
    ]);

    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    for (const [logicalId, alarm] of Object.entries(alarms)) {
      if (exceptions.has(alarm.Properties.AlarmName as string)) continue;
      expect(alarm.Properties.TreatMissingData, `${logicalId} の欠損時の扱いが違う`).toBe(
        'notBreaching',
      );
    }
  });

  // スケジュールが止まると Lambda は動かず、エラーすら記録されないまま監視が消える。
  // Lambda の Invocations は呼び出しが無いと 0 ではなく「記録なし」になるため、
  // 実際に発報させているのは欠損の扱い（breaching）のほう
  it('外形監視とカナリアが「動いていないこと」自体を検知する', () => {
    for (const [name, window] of [
      ['dev-sakekasu-watcher-silent-health-check', 3600],
      ['dev-sakekasu-watcher-silent-sommelier-canary', 43200],
    ] as const) {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: name,
        MetricName: 'Invocations',
        Threshold: 1,
        Period: window,
        // 沈黙は欠損として現れる。ここが発報の実体
        TreatMissingData: 'breaching',
        // 発報の実体ではないが、既定値（しきい値以上で異常）に戻ると意味が反転し、
        // 「動いているときに鳴る」アラームになってしまうため固定する
        ComparisonOperator: 'LessThanThreshold',
      });
    }
  });

  // 6時間に1度しか計測しないため、空白を異常なしと扱うと
  // 直っていないのに復旧通知が飛んでしまう
  it('カナリアは計測の空白で復旧扱いにしない', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'dev-sakekasu-sommelier-canary',
      TreatMissingData: 'missing',
    });
  });

  // 認証が二段構えのため、登録漏れだと必ず403になる。Slack だけで原因に辿り着けるようにする
  it('カナリアのアラート本文にクライアント登録漏れの確認を促す案内を入れる', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    const canaryAlarm = Object.values(alarms).find(
      (alarm) => alarm.Properties?.AlarmName === 'dev-sakekasu-sommelier-canary',
    );
    expect(canaryAlarm).toBeDefined();

    const description = canaryAlarm!.Properties.AlarmDescription as string;
    expect(description).toContain('allowedClients');
    expect(description).toContain('COGNITO_APP_CLIENT_ID');
  });

  // 監視が動かなくなると異常に気づけない
  it('外形監視とカナリアの実行失敗そのものを監視する', () => {
    for (const alarmName of [
      'dev-sakekasu-watcher-failure-health-check',
      'dev-sakekasu-watcher-failure-sommelier-canary',
    ]) {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', { AlarmName: alarmName });
    }
  });

  it('外形監視を5分ごとに回す', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Name: 'dev-sakekasu-health-check-schedule',
      ScheduleExpression: 'rate(5 minutes)',
    });
  });

  it('外形監視は認証なしで叩いて拒否が返ることを正常とみなす', () => {
    const functions = template.findResources('AWS::Lambda::Function');
    const healthCheck = Object.values(functions).find(
      (fn) => fn.Properties?.FunctionName === 'dev-sakekasu-health-check',
    );
    expect(healthCheck).toBeDefined();

    // AppSync の URL がデプロイ時解決のトークンのため、値は Fn::Join になる。
    // 静的な部分だけ繋いで中身を確かめる
    const targets = flattenJoin(
      healthCheck!.Properties.Environment.Variables.HEALTH_CHECK_TARGETS,
    );

    expect(targets).toContain('"name":"frontend"');
    expect(targets).toContain('"expectStatus":[200]');
    // 認証なしで叩き、拒否されることを正常とみなす
    expect(targets).toContain('"name":"sommelier-runtime"');
    expect(targets).toContain('"expectStatus":[401,403]');
    expect(targets).toContain('"name":"appsync"');
    // 空の本文だと GraphQL の形式エラーで認証まで届かず、401 を確認できない
    expect(targets).toContain('__typename');
  });

  it('外形監視は2回続けて失敗したときだけ通知する', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'dev-sakekasu-health-check-frontend',
      EvaluationPeriods: 2,
    });
  });

  it('ソムリエのカナリアは費用を抑えるため6時間ごとに回す', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Name: 'dev-sakekasu-sommelier-canary-schedule',
      ScheduleExpression: 'rate(6 hours)',
    });
  });

  it('カナリアの認証情報は Secrets Manager 名だけを渡す', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'dev-sakekasu-sommelier-canary',
      Environment: {
        Variables: Match.objectLike({
          CREDENTIALS_SECRET_ID: 'dev-sakekasu/monitoring/canary-user',
        }),
      },
    });
  });

  it('カナリアの Cognito 権限は対象ユーザープールだけに絞る', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'cognito-idp:AdminInitiateAuth',
            Resource:
              'arn:aws:cognito-idp:ap-northeast-1:111122223333:userpool/ap-northeast-1_TEST',
          }),
        ]),
      },
    });
  });

  it('メトリクス書き込みは自分の名前空間だけに限定する', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'cloudwatch:PutMetricData',
            Condition: { StringEquals: { 'cloudwatch:namespace': 'dev-sakekasu-monitoring' } },
          }),
        ]),
      },
    });
  });

  // ブラウザ向けクライアントにパスワード認証を持たせない（SRP のみ）
  it('ブラウザ向けクライアントは SRP のみを許可する', () => {
    authTemplate.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'dev-sakekasu-client',
      ExplicitAuthFlows: Match.not(Match.arrayWith(['ALLOW_ADMIN_USER_PASSWORD_AUTH'])),
    });
  });

  // カナリアは専用クライアントでサインインする
  it('カナリア専用クライアントだけが管理者パスワード認証を持つ', () => {
    authTemplate.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'dev-sakekasu-canary-client',
      ExplicitAuthFlows: Match.arrayWith(['ALLOW_ADMIN_USER_PASSWORD_AUTH']),
    });
  });

  // 存在しない利用者と誤ったパスワードの応答を揃え、登録済みアドレスを割り出せなくする
  it('カナリア専用クライアントは利用者の存在を隠す', () => {
    authTemplate.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'dev-sakekasu-canary-client',
      PreventUserExistenceErrors: 'ENABLED',
    });
  });

  it('カナリアはブラウザ向けではなく専用クライアントを使う', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'dev-sakekasu-sommelier-canary',
      Environment: {
        Variables: Match.objectLike({ USER_POOL_CLIENT_ID: 'canaryclientid' }),
      },
    });
  });

  // AWS 側の障害は自分たちでは直せないが、気づかないと対応が遅れる
  it('AWS Health のイベントを SNS へ流すルールがある', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Name: 'dev-sakekasu-aws-health',
      EventPattern: {
        source: ['aws.health'],
        detail: { eventTypeCategory: ['issue', 'scheduledChange'] },
      },
      State: 'ENABLED',
    });
  });

  // お知らせや調査中まで拾うと日常的に鳴ってノイズになる
  it('Health は障害と予定変更だけに絞る', () => {
    const rules = template.findResources('AWS::Events::Rule');
    const health = Object.values(rules).find(
      (r) => r.Properties?.Name === 'dev-sakekasu-aws-health',
    );
    const categories = health!.Properties.EventPattern.detail.eventTypeCategory as string[];
    expect(categories).not.toContain('accountNotification');
    expect(categories).not.toContain('investigation');
  });

  it('Health ルールの宛先が通知用の SNS トピックである', () => {
    const rules = template.findResources('AWS::Events::Rule');
    const health = Object.values(rules).find(
      (r) => r.Properties?.Name === 'dev-sakekasu-aws-health',
    );
    expect(health!.Properties.Targets).toHaveLength(1);
    // トピックは同スタック内なので Ref で参照される
    expect(JSON.stringify(health!.Properties.Targets[0])).toContain('AlertTopic');
  });

  // Issue #86: Application Signals
  describe('Application Signals', () => {
    it('アカウント単位の設定はスタックに持たせない', () => {
      // どちらもアカウントに1つの設定で、既に有効になっている。
      // スタックへ足すと AlreadyExists で失敗し、そのロールバックが
      // 既存の設定を消しにいく（ソムリエの可観測性を巻き込む）
      template.resourceCountIs('AWS::ApplicationSignals::Discovery', 0);
      template.resourceCountIs('AWS::XRay::TransactionSearchConfig', 0);
    });

    // SLO は Application Signals の課金対象なので、増える方向の変更に気づきたい。
    // 数を固定しておけば、3つ目を足すときにこのテストが目に入る
    it('SLO は OCR の2つだけ', () => {
      template.resourceCountIs('AWS::ApplicationSignals::ServiceLevelObjective', 2);
    });

    // SLO が対象のサービスを見つけられないと、達成率が空のまま「作れてはいる」
    // 状態になる。KeyAttributes は実機のメトリクスのディメンションと一致して
    // いないといけないので、推測で書き換えられないよう固定する
    it.each([
      ['dev-sakekasu-ocr-analyzer-availability', 'AVAILABILITY'],
      ['dev-sakekasu-ocr-analyzer-latency', 'LATENCY'],
    ])('%s は OCR のサービスを指している', (name, metricType) => {
      template.hasResourceProperties('AWS::ApplicationSignals::ServiceLevelObjective', {
        Name: name,
        RequestBasedSli: Match.objectLike({
          RequestBasedSliMetric: Match.objectLike({
            KeyAttributes: {
              Type: 'Service',
              Name: 'dev-sakekasu-ocr-analyzer',
              Environment: 'lambda:default',
            },
            MetricType: metricType,
          }),
        }),
      });
    });

    // 演算子としきい値が SLO の意味そのもの。演算子が反転すると「遅いほど
    // 達成率が高い」になり、単位を取り違えると常に達成（15000 秒＝約4時間）か
    // 常に未達（15 ミリ秒）になる。どちらも「SLO はあるのに何も見ていない」
    // 状態なので、値を固定する（PR #161 のレビュー指摘）。
    //
    // ApplicationSignals の Latency はミリ秒。実測の生値が4桁で、
    // get-metric-statistics の応答も Unit: Milliseconds を返す
    it('レイテンシー SLO は 15 秒（15000 ミリ秒）未満を条件にしている', () => {
      template.hasResourceProperties('AWS::ApplicationSignals::ServiceLevelObjective', {
        Name: 'dev-sakekasu-ocr-analyzer-latency',
        RequestBasedSli: Match.objectLike({
          ComparisonOperator: 'LessThan',
          MetricThreshold: 15000,
        }),
      });
    });

    // 可用性 SLO は成功率そのものを見るので、しきい値も演算子も持たない。
    // ここに値が入っているのは、レイテンシー用の設定を書き写した取り違え
    it('可用性 SLO はしきい値を持たない', () => {
      const slos = template.findResources('AWS::ApplicationSignals::ServiceLevelObjective', {
        Properties: { Name: 'dev-sakekasu-ocr-analyzer-availability' },
      });
      const [slo] = Object.values(slos);

      expect(slo).toBeDefined();
      expect(slo.Properties?.RequestBasedSli?.MetricThreshold).toBeUndefined();
      expect(slo.Properties?.RequestBasedSli?.ComparisonOperator).toBeUndefined();
    });

    // 日に数回しか呼ばれないので period-based では判定が成り立たない。
    // 種別が入れ替わると「ほとんどの期間がデータ無し」で達成率が壊れる
    it('SLO は request-based で定義している', () => {
      const slos = Object.values(
        template.findResources('AWS::ApplicationSignals::ServiceLevelObjective'),
      );

      expect(slos.length).toBeGreaterThan(0);
      for (const slo of slos) {
        expect(slo.Properties?.RequestBasedSli, `${slo.Properties?.Name} が request-based でない`)
          .toBeDefined();
        expect(slo.Properties?.Sli, `${slo.Properties?.Name} に period-based の定義が混ざっている`)
          .toBeUndefined();
      }
    });

    // SLO を割ったことに気づけないと、定義しただけで終わる。
    // ディメンションが SLO 名と一致していないとアラームは INSUFFICIENT_DATA の
    // まま居座り、監視が入っているように見えて何も鳴らない
    it.each([
      ['dev-sakekasu-ocr-slo-availability', 'dev-sakekasu-ocr-analyzer-availability'],
      ['dev-sakekasu-ocr-slo-latency', 'dev-sakekasu-ocr-analyzer-latency'],
    ])('%s は %s の達成率を見ている', (alarmName, sloName) => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: alarmName,
        Namespace: 'AWS/ApplicationSignals',
        MetricName: 'AttainmentRate',
        Dimensions: [{ Name: 'SloName', Value: sloName }],
      });
    });

    // 「下回ったら異常」。既定は「以上で異常」なので、指定を落とすと
    // 達成率が高いときに鳴る逆立ちしたアラームになる
    it.each(['dev-sakekasu-ocr-slo-availability', 'dev-sakekasu-ocr-slo-latency'])(
      '%s は目標を下回ったときに鳴る',
      (alarmName) => {
        template.hasResourceProperties('AWS::CloudWatch::Alarm', {
          AlarmName: alarmName,
          ComparisonOperator: 'LessThanThreshold',
          Threshold: 90,
          // 値が出なくなったときに「復旧した」と判定させない
          TreatMissingData: 'missing',
        });
      },
    );

    // 名前がずれるとアラームは INSUFFICIENT_DATA のまま居座り、合成もデプロイも
    // 成功する。リテラルで書いた期待値と突き合わせるのではなく、**合成結果の
    // SLO 名そのもの**と突き合わせる。こうしておけば、名前を変えたときに
    // 片側だけ直しても落ちる（PR #165 のレビュー指摘）
    it('アラームは実在する SLO を指している', () => {
      const sloNames = new Set(
        Object.values(
          template.findResources('AWS::ApplicationSignals::ServiceLevelObjective'),
        ).map((slo) => slo.Properties?.Name),
      );
      const alarms = Object.values(
        template.findResources('AWS::CloudWatch::Alarm', {
          Properties: { MetricName: 'AttainmentRate' },
        }),
      );

      expect(sloNames.size).toBeGreaterThan(0);
      expect(alarms.length, 'SLO の数だけアラームが要る').toBe(sloNames.size);

      for (const alarm of alarms) {
        const dimension = (alarm.Properties?.Dimensions ?? []).find(
          (d: { Name: string }) => d.Name === 'SloName',
        );
        expect(
          sloNames.has(dimension?.Value),
          `${alarm.Properties?.AlarmName} が存在しない SLO（${dimension?.Value}）を指している`,
        ).toBe(true);
      }
    });

    // SLO の目標とアラームのしきい値が食い違うと、SLO 上は未達なのに
    // アラームは鳴らない（あるいはその逆）状態が黙って生まれる
    it('SLO の目標とアラームのしきい値が一致している', () => {
      const goals = Object.values(
        template.findResources('AWS::ApplicationSignals::ServiceLevelObjective'),
      ).map((slo) => slo.Properties?.Goal?.AttainmentGoal);

      const thresholds = Object.values(
        template.findResources('AWS::CloudWatch::Alarm', {
          Properties: { MetricName: 'AttainmentRate' },
        }),
      ).map((alarm) => alarm.Properties?.Threshold);

      expect(goals.length).toBeGreaterThan(0);
      expect(thresholds.length).toBe(goals.length);
      expect(new Set([...goals, ...thresholds]).size, '目標としきい値が食い違っている').toBe(1);
    });

    // 日に数回しか呼ばれないので、1時間窓にするとほとんどが「データ無し」に
    // なる。バーンレートは窓の選び方がそのまま使い物になるかを決める
    it('SLO のバーンレートは1日窓だけを使う', () => {
      const slos = Object.values(
        template.findResources('AWS::ApplicationSignals::ServiceLevelObjective'),
      );

      expect(slos.length).toBeGreaterThan(0);
      for (const slo of slos) {
        expect(
          slo.Properties?.BurnRateConfigurations,
          `${slo.Properties?.Name} の参照窓`,
        ).toEqual([{ LookBackWindowMinutes: 1440 }]);
      }
    });

    // 30日の budget で緩やかな失敗を見るのが目的。7日（既定）に戻ると、
    // 日に数回の規模では母数が小さすぎて 1 回の失敗で budget を使い切る
    it('SLO は 30 日の rolling で 90% を目標にしている', () => {
      const slos = Object.values(
        template.findResources('AWS::ApplicationSignals::ServiceLevelObjective'),
      );

      for (const slo of slos) {
        expect(slo.Properties?.Goal?.AttainmentGoal, `${slo.Properties?.Name} の目標値`).toBe(90);
        expect(
          slo.Properties?.Goal?.Interval?.RollingInterval,
          `${slo.Properties?.Name} の評価期間`,
        ).toEqual({ Duration: 30, DurationUnit: 'DAY' });
      }
    });
  });
});
