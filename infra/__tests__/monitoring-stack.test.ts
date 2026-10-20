import { Template, Match } from "aws-cdk-lib/assertions";
import * as cdk from "aws-cdk-lib";
import { ApiStack } from "../lib/api-stack.js";
import { MonitoringStack } from "../lib/monitoring-stack.js";
import { TEST_SHARED_AUTH } from "./shared-auth-fixture.js";

const TEST_ACCOUNT = "111122223333";
const TEST_REGION = "ap-northeast-1";

const RUNTIME_ARN =
  "arn:aws:bedrock-agentcore:ap-northeast-1:111122223333:runtime/sommelier_test-ABC123";

/** Fn::Join の静的な文字列部分だけを繋ぐ（トークンは無視する） */
function flattenJoin(value: unknown): string {
  if (typeof value === "string") return value;
  const join = (value as { "Fn::Join"?: [string, unknown[]] })?.["Fn::Join"];
  if (!join) return JSON.stringify(value);
  const [separator, parts] = join;
  return parts
    .map((part) => (typeof part === "string" ? part : ""))
    .join(separator);
}

function synth() {
  const app = new cdk.App();
  const env = { account: TEST_ACCOUNT, region: TEST_REGION };

  const apiStack = new ApiStack(app, "TestApi", {
    envName: "dev",
    sharedAuth: TEST_SHARED_AUTH,
    env,
  });
  const monitoringStack = new MonitoringStack(app, "TestMonitoring", {
    envName: "dev",
    graphqlApi: apiStack.graphqlApi,
    tables: [apiStack.purchaseTable, apiStack.drinkingTable],
    functions: [apiStack.presignedUrlFunction, apiStack.ocrAnalyzerFunction],
    ocrFunction: apiStack.ocrAnalyzerFunction,
    imageDeleteFailMetricFilter: apiStack.imageDeleteFailMetricFilter,
    sommelierRuntimeArn: RUNTIME_ARN,
    env,
  });

  return {
    template: Template.fromStack(monitoringStack),
  };
}

describe("MonitoringStack", () => {
  let template: Template;

  beforeAll(() => {
    template = synth().template;
  });

  it("自分の SNS トピックとトピックポリシーを持たない（送り先は共通基盤のトピック）", () => {
    template.resourceCountIs("AWS::SNS::Topic", 0);
    template.resourceCountIs("AWS::SNS::TopicPolicy", 0);
    template.resourceCountIs("AWS::SNS::Subscription", 0);
  });

  /**
   * アラームの送り先は 4 アプリ共通のトピック（共通基盤の sakekasu-integrated-alerts）。
   * Slack 通知と DevOps Agent への転送はそちらが持つ。CloudWatch からの publish を許すトピックポリシーも
   * 共通基盤の側にある（共通基盤の lib/monitoring-stack.ts）。
   *
   * ARN は名前から組み立てる（共通基盤のスタックの出力を参照しない）。名前を書き違えると
   * 合成もデプロイも通るのに、どこにも届かない
   */
  it("アラームの通知先が共通基盤のトピックである（発報も復旧も）", () => {
    const alarms = template.findResources("AWS::CloudWatch::Alarm");
    const alarmList = Object.values(alarms);
    expect(alarmList.length).toBeGreaterThan(0);

    const shared = `arn:aws:sns:${TEST_REGION}:${TEST_ACCOUNT}:sakekasu-integrated-alerts`;
    for (const alarm of alarmList) {
      expect(alarm.Properties?.AlarmActions).toEqual([shared]);
      expect(alarm.Properties?.OKActions).toEqual([shared]);
    }
  });

  // 今回の障害を検知できる本命のアラーム
  it("ソムリエの認証拒否を例外の種類ごとに監視する", () => {
    for (const exceptionType of [
      "UnauthorizedInboundTokenException",
      "InvalidInboundTokenException",
    ]) {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmName: `sakekasu-builder-dev-sommelier-auth-failure-${exceptionType}`,
        Namespace: "AWS/Bedrock-AgentCore",
        MetricName: "InboundAuthorizationFailure",
        Dimensions: Match.arrayWith([
          { Name: "ExceptionType", Value: exceptionType },
          { Name: "ResourceId", Value: RUNTIME_ARN },
        ]),
      });
    }
  });

  it("AI 機能（ソムリエ・OCR）のエラーとスロットルを監視する", () => {
    for (const alarmName of [
      "sakekasu-builder-dev-sommelier-system-errors",
      "sakekasu-builder-dev-sommelier-throttles",
      "sakekasu-builder-dev-ocr-errors",
      "sakekasu-builder-dev-ocr-throttles",
    ]) {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmName: alarmName,
      });
    }
  });

  // 同じ指標を 2 本のアラームで見ると、1 回の障害で通知が 2 通届く
  it("OCR の Lambda エラーは ocr-errors の 1 本だけで見る", () => {
    const alarms = Object.values(template.findResources("AWS::CloudWatch::Alarm")) as {
      Properties: { MetricName?: string; Namespace?: string; Dimensions?: { Name: string; Value: unknown }[] };
    }[];
    const ocrErrorAlarms = alarms.filter(
      ({ Properties: p }) =>
        p.Namespace === "AWS/Lambda" &&
        p.MetricName === "Errors" &&
        JSON.stringify(p.Dimensions ?? []).includes("OcrAnalyzer"),
    );
    expect(ocrErrorAlarms).toHaveLength(1);
  });

  it("サービス正常性（AppSync・DynamoDB）を監視する", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "sakekasu-builder-dev-appsync-5xx",
      Namespace: "AWS/AppSync",
      MetricName: "5XXError",
    });
  });

  // ThrottledRequests は TableName と Operation の組でしか出ないので、TableName だけで見ると
  // データが無い扱いになり一度も鳴らない。テーブル単位で出る Read/WriteThrottleEvents を見る
  type AlarmMetricEntry = {
    Expression?: string;
    ReturnData?: boolean;
    MetricStat?: {
      Metric: { Namespace: string; MetricName: string; Dimensions: Array<{ Name: string }> };
    };
  };
  it("DynamoDB のスロットリングはテーブル単位で出る指標で見る", () => {
    const alarms = Object.values(
      template.findResources("AWS::CloudWatch::Alarm", {
        Properties: { AlarmName: Match.stringLikeRegexp("^sakekasu-builder-dev-dynamodb-throttle-") },
      }),
    ) as Array<{ Properties: { MetricName?: string; Metrics: AlarmMetricEntry[] } }>;
    expect(alarms.length).toBeGreaterThan(0);

    for (const { Properties: p } of alarms) {
      expect(p.MetricName).toBeUndefined();
      const metrics = p.Metrics;
      const expression = metrics.find((m) => m.Expression);
      expect(expression?.Expression).toBe("FILL(r, 0) + FILL(w, 0)");
      expect(expression?.ReturnData).not.toBe(false);

      const names = metrics
        .filter((m) => m.MetricStat)
        .map((m) => {
          const metric = m.MetricStat!.Metric;
          expect(metric.Namespace).toBe("AWS/DynamoDB");
          expect(metric.Dimensions.map((d) => d.Name)).toEqual(["TableName"]);
          return metric.MetricName;
        });
      expect(names.sort()).toEqual(["ReadThrottleEvents", "WriteThrottleEvents"]);
    }
  });

  it("ThrottledRequests を TableName だけで見るアラームを作らない", () => {
    expect(JSON.stringify(template.toJSON())).not.toContain("ThrottledRequests");
  });

  // 以前は ApiStack にあり通知先が無かった
  it("画像削除失敗アラームを引き継ぎ、通知先を持たせる", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "sakekasu-builder-dev-image-delete-fail",
      MetricName: "ImageDeleteFailCount",
    });
  });

  it("すべてのアラームが発報と復旧の両方を通知する", () => {
    const alarms = template.findResources("AWS::CloudWatch::Alarm");
    expect(Object.keys(alarms).length).toBeGreaterThan(0);

    for (const [logicalId, alarm] of Object.entries(alarms)) {
      expect(
        alarm.Properties.AlarmActions,
        `${logicalId} に発報通知が無い`,
      ).toBeDefined();
      expect(
        alarm.Properties.OKActions,
        `${logicalId} に復旧通知が無い`,
      ).toBeDefined();
    }
  });

  it("利用が無い時間帯に鳴らさない（欠損を異常扱いするのは意図したものだけ）", () => {
    // 欠損に意味がある指標は個別に扱う。
    // - 実行回数: 記録が無い＝動いていないので、欠損そのものが異常
    // - SLO の達成率: 30日の rolling で動きが遅い。値が出なくなったときに
    //   「異常なし」と扱うと、未達のまま復旧したことになってしまう
    const exceptions = new Set([
      "sakekasu-builder-dev-watcher-silent-health-check",
      "sakekasu-builder-dev-ocr-slo-availability",
      "sakekasu-builder-dev-ocr-slo-latency",
      "sakekasu-builder-dev-presigned-url-slo-availability",
      "sakekasu-builder-dev-presigned-url-slo-latency",
    ]);

    const alarms = template.findResources("AWS::CloudWatch::Alarm");
    for (const [logicalId, alarm] of Object.entries(alarms)) {
      if (exceptions.has(alarm.Properties.AlarmName as string)) continue;
      expect(
        alarm.Properties.TreatMissingData,
        `${logicalId} の欠損時の扱いが違う`,
      ).toBe("notBreaching");
    }
  });

  // スケジュールが止まると Lambda は動かず、エラーすら記録されないまま監視が消える。
  // Lambda の Invocations は呼び出しが無いと 0 ではなく「記録なし」になるため、
  // 実際に発報させているのは欠損の扱い（breaching）のほう
  it("外形監視が「動いていないこと」自体を検知する", () => {
    for (const [name, window] of [
      ["sakekasu-builder-dev-watcher-silent-health-check", 3600],
    ] as const) {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmName: name,
        MetricName: "Invocations",
        Threshold: 1,
        Period: window,
        // 沈黙は欠損として現れる。ここが発報の実体
        TreatMissingData: "breaching",
        // 発報の実体ではないが、既定値（しきい値以上で異常）に戻ると意味が反転し、
        // 「動いているときに鳴る」アラームになってしまうため固定する
        ComparisonOperator: "LessThanThreshold",
      });
    }
  });

  // 監視が動かなくなると異常に気づけない
  it("外形監視の実行失敗そのものを監視する", () => {
    for (const alarmName of [
      "sakekasu-builder-dev-watcher-failure-health-check",
    ]) {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmName: alarmName,
      });
    }
  });

  it("外形監視を5分ごとに回す", () => {
    template.hasResourceProperties("AWS::Events::Rule", {
      Name: "sakekasu-builder-dev-health-check-schedule",
      ScheduleExpression: "rate(5 minutes)",
    });
  });

  it("外形監視は認証なしで叩いて拒否が返ることを正常とみなす", () => {
    const functions = template.findResources("AWS::Lambda::Function");
    const healthCheck = Object.values(functions).find(
      (fn) => fn.Properties?.FunctionName === "sakekasu-builder-dev-health-check",
    );
    expect(healthCheck).toBeDefined();

    // AppSync の URL がデプロイ時解決のトークンのため、値は Fn::Join になる。
    // 静的な部分だけ繋いで中身を確かめる
    const targets = flattenJoin(
      healthCheck!.Properties.Environment.Variables.HEALTH_CHECK_TARGETS,
    );

    // サイトは共通基盤の外形監視が見るので、ここには置かない
    expect(targets).not.toContain('"name":"frontend"');
    // 認証なしで叩き、拒否されることを正常とみなす
    expect(targets).toContain('"name":"sommelier-runtime"');
    expect(targets).toContain('"expectStatus":[401,403]');
    expect(targets).toContain('"name":"appsync"');
    // 空の本文だと GraphQL の形式エラーで認証まで届かず、401 を確認できない
    expect(targets).toContain("__typename");
  });

  it("外形監視は2回続けて失敗したときだけ通知する", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "sakekasu-builder-dev-health-check-appsync",
      EvaluationPeriods: 2,
    });
  });

  it("メトリクス書き込みは自分の名前空間だけに限定する", () => {
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "cloudwatch:PutMetricData",
            Condition: {
              StringEquals: {
                "cloudwatch:namespace": "dev-sakekasu-monitoring",
              },
            },
          }),
        ]),
      },
    });
  });

  // ソムリエのカナリアは旧プール（sakekasu-dev-auth）でサインインしていた。
  // 共通ログインにはパスワードで直接サインインする経路が無いので、コードごと消した。
  // 旧プールを外すには、まずこのスタックが旧プールを読まなくなっている必要がある
  // （docs/shared-login.md の「旧プールを外す」）
  it("カナリアを持たず、Cognito に触れない", () => {
    const functionNames = Object.values(
      template.findResources("AWS::Lambda::Function"),
    ).map((fn) => fn.Properties?.FunctionName);
    expect(functionNames).not.toContain("dev-sakekasu-sommelier-canary");

    const json = JSON.stringify(template.toJSON());
    expect(json).not.toContain("cognito-idp");
    expect(json).not.toContain("canary");
  });

  // AWS Health の通知は共通基盤（sakekasu-integrated_environment）だけが持つ。
  // こちらにも戻すと同じ通知が 2 通届く
  it("AWS Health のルールを持たない", () => {
    const rules = Object.values(template.findResources("AWS::Events::Rule"));
    const healthRules = rules.filter((r) =>
      JSON.stringify(r.Properties?.EventPattern ?? {}).includes("aws.health"),
    );
    expect(healthRules).toHaveLength(0);
  });

  // Issue #86: Application Signals
  describe("Application Signals", () => {
    it("アカウント単位の設定はスタックに持たせない", () => {
      // どちらもアカウントに1つの設定で、既に有効になっている。
      // スタックへ足すと AlreadyExists で失敗し、そのロールバックが
      // 既存の設定を消しにいく（ソムリエの可観測性を巻き込む）
      template.resourceCountIs("AWS::ApplicationSignals::Discovery", 0);
      template.resourceCountIs("AWS::XRay::TransactionSearchConfig", 0);
    });

    // SLO は Application Signals の課金対象なので、増える方向の変更に気づきたい。
    // 数を固定しておけば、3つ目を足すときにこのテストが目に入る
    it("SLO は OCR と presigned-url の4つだけ", () => {
      template.resourceCountIs(
        "AWS::ApplicationSignals::ServiceLevelObjective",
        4,
      );
    });

    // SLO が対象のサービスを見つけられないと、達成率が空のまま「作れてはいる」
    // 状態になる。KeyAttributes は実機のメトリクスのディメンションと一致して
    // いないといけないので、推測で書き換えられないよう固定する
    it.each([
      [
        "dev-sakekasu-ocr-analyzer-availability",
        "dev-sakekasu-ocr-analyzer",
        "AVAILABILITY",
      ],
      [
        "dev-sakekasu-ocr-analyzer-latency",
        "dev-sakekasu-ocr-analyzer",
        "LATENCY",
      ],
      [
        "dev-sakekasu-presigned-url-availability",
        "dev-sakekasu-presigned-url",
        "AVAILABILITY",
      ],
      [
        "dev-sakekasu-presigned-url-latency",
        "dev-sakekasu-presigned-url",
        "LATENCY",
      ],
    ])("%s は %s のサービスを指している", (name, serviceName, metricType) => {
      template.hasResourceProperties(
        "AWS::ApplicationSignals::ServiceLevelObjective",
        {
          Name: name,
          RequestBasedSli: Match.objectLike({
            RequestBasedSliMetric: Match.objectLike({
              KeyAttributes: {
                Type: "Service",
                Name: serviceName,
                Environment: "lambda:default",
              },
              MetricType: metricType,
            }),
          }),
        },
      );
    });

    // 演算子としきい値が SLO の意味そのもの。演算子が反転すると「遅いほど
    // 達成率が高い」になり、単位を取り違えると常に達成（15000 秒＝約4時間）か
    // 常に未達（15 ミリ秒）になる。どちらも「SLO はあるのに何も見ていない」
    // 状態なので、値を固定する（PR #161 のレビュー指摘）。
    //
    // ApplicationSignals の Latency はミリ秒。実測の生値が4桁で、
    // get-metric-statistics の応答も Unit: Milliseconds を返す
    it.each([
      ["dev-sakekasu-ocr-analyzer-latency", 15000],
      ["dev-sakekasu-presigned-url-latency", 2000],
    ])("%s は %d ミリ秒未満を条件にしている", (name, threshold) => {
      template.hasResourceProperties(
        "AWS::ApplicationSignals::ServiceLevelObjective",
        {
          Name: name,
          RequestBasedSli: Match.objectLike({
            ComparisonOperator: "LessThan",
            MetricThreshold: threshold,
          }),
        },
      );
    });

    // 可用性 SLO は成功率そのものを見るので、しきい値も演算子も持たない。
    // ここに値が入っているのは、レイテンシー用の設定を書き写した取り違え
    it.each([
      "dev-sakekasu-ocr-analyzer-availability",
      "dev-sakekasu-presigned-url-availability",
    ])("%s はしきい値を持たない", (name) => {
      const slos = template.findResources(
        "AWS::ApplicationSignals::ServiceLevelObjective",
        {
          Properties: { Name: name },
        },
      );
      const [slo] = Object.values(slos);

      expect(slo).toBeDefined();
      expect(slo.Properties?.RequestBasedSli?.MetricThreshold).toBeUndefined();
      expect(
        slo.Properties?.RequestBasedSli?.ComparisonOperator,
      ).toBeUndefined();
    });

    // 日に数回しか呼ばれないので period-based では判定が成り立たない。
    // 種別が入れ替わると「ほとんどの期間がデータ無し」で達成率が壊れる
    it("SLO は request-based で定義している", () => {
      const slos = Object.values(
        template.findResources(
          "AWS::ApplicationSignals::ServiceLevelObjective",
        ),
      );

      expect(slos.length).toBeGreaterThan(0);
      for (const slo of slos) {
        expect(
          slo.Properties?.RequestBasedSli,
          `${slo.Properties?.Name} が request-based でない`,
        ).toBeDefined();
        expect(
          slo.Properties?.Sli,
          `${slo.Properties?.Name} に period-based の定義が混ざっている`,
        ).toBeUndefined();
      }
    });

    // SLO を割ったことに気づけないと、定義しただけで終わる。
    // ディメンションが SLO 名と一致していないとアラームは INSUFFICIENT_DATA の
    // まま居座り、監視が入っているように見えて何も鳴らない
    it.each([
      [
        "sakekasu-builder-dev-ocr-slo-availability",
        "dev-sakekasu-ocr-analyzer-availability",
      ],
      ["sakekasu-builder-dev-ocr-slo-latency", "dev-sakekasu-ocr-analyzer-latency"],
      [
        "sakekasu-builder-dev-presigned-url-slo-availability",
        "dev-sakekasu-presigned-url-availability",
      ],
      [
        "sakekasu-builder-dev-presigned-url-slo-latency",
        "dev-sakekasu-presigned-url-latency",
      ],
    ])("%s は %s の達成率を見ている", (alarmName, sloName) => {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmName: alarmName,
        Namespace: "AWS/ApplicationSignals",
        MetricName: "AttainmentRate",
        Dimensions: [{ Name: "SloName", Value: sloName }],
      });
    });

    // 「下回ったら異常」。既定は「以上で異常」なので、指定を落とすと
    // 達成率が高いときに鳴る逆立ちしたアラームになる
    it.each([
      "sakekasu-builder-dev-ocr-slo-availability",
      "sakekasu-builder-dev-ocr-slo-latency",
      "sakekasu-builder-dev-presigned-url-slo-availability",
      "sakekasu-builder-dev-presigned-url-slo-latency",
    ])("%s は目標を下回ったときに鳴る", (alarmName) => {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmName: alarmName,
        ComparisonOperator: "LessThanThreshold",
        Threshold: 90,
        // 値が出なくなったときに「復旧した」と判定させない
        TreatMissingData: "missing",
      });
    });

    // 名前がずれるとアラームは INSUFFICIENT_DATA のまま居座り、合成もデプロイも
    // 成功する。リテラルで書いた期待値と突き合わせるのではなく、**合成結果の
    // SLO 名そのもの**と突き合わせる。こうしておけば、名前を変えたときに
    // 片側だけ直しても落ちる（PR #165 のレビュー指摘）
    it("アラームは実在する SLO を指している", () => {
      const sloNames = new Set(
        Object.values(
          template.findResources(
            "AWS::ApplicationSignals::ServiceLevelObjective",
          ),
        ).map((slo) => slo.Properties?.Name),
      );
      const alarms = Object.values(
        template.findResources("AWS::CloudWatch::Alarm", {
          Properties: { MetricName: "AttainmentRate" },
        }),
      );

      expect(sloNames.size).toBeGreaterThan(0);
      expect(alarms.length, "SLO の数だけアラームが要る").toBe(sloNames.size);

      for (const alarm of alarms) {
        const dimension = (alarm.Properties?.Dimensions ?? []).find(
          (d: { Name: string }) => d.Name === "SloName",
        );
        expect(
          sloNames.has(dimension?.Value),
          `${alarm.Properties?.AlarmName} が存在しない SLO（${dimension?.Value}）を指している`,
        ).toBe(true);
      }
    });

    // SLO の目標とアラームのしきい値が食い違うと、SLO 上は未達なのに
    // アラームは鳴らない（あるいはその逆）状態が黙って生まれる
    it("SLO の目標とアラームのしきい値が一致している", () => {
      const goals = Object.values(
        template.findResources(
          "AWS::ApplicationSignals::ServiceLevelObjective",
        ),
      ).map((slo) => slo.Properties?.Goal?.AttainmentGoal);

      const thresholds = Object.values(
        template.findResources("AWS::CloudWatch::Alarm", {
          Properties: { MetricName: "AttainmentRate" },
        }),
      ).map((alarm) => alarm.Properties?.Threshold);

      expect(goals.length).toBeGreaterThan(0);
      expect(thresholds.length).toBe(goals.length);
      expect(
        new Set([...goals, ...thresholds]).size,
        "目標としきい値が食い違っている",
      ).toBe(1);
    });

    // 日に数回しか呼ばれないので、1時間窓にするとほとんどが「データ無し」に
    // なる。バーンレートは窓の選び方がそのまま使い物になるかを決める
    it("SLO のバーンレートは1日窓だけを使う", () => {
      const slos = Object.values(
        template.findResources(
          "AWS::ApplicationSignals::ServiceLevelObjective",
        ),
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
    it("SLO は 30 日の rolling で 90% を目標にしている", () => {
      const slos = Object.values(
        template.findResources(
          "AWS::ApplicationSignals::ServiceLevelObjective",
        ),
      );

      for (const slo of slos) {
        expect(
          slo.Properties?.Goal?.AttainmentGoal,
          `${slo.Properties?.Name} の目標値`,
        ).toBe(90);
        expect(
          slo.Properties?.Goal?.Interval?.RollingInterval,
          `${slo.Properties?.Name} の評価期間`,
        ).toEqual({ Duration: 30, DurationUnit: "DAY" });
      }
    });
  });
});
