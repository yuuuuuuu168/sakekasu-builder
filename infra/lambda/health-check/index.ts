import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const cloudwatch = new CloudWatchClient({});

const METRIC_NAMESPACE = process.env.METRIC_NAMESPACE!;
/** 監視対象の定義（JSON 配列）。CDK から渡す */
const TARGETS = process.env.HEALTH_CHECK_TARGETS!;
/** 1件あたりの待ち時間 */
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? '10000');

/**
 * 外形監視の対象。
 *
 * ソムリエ Runtime や AppSync は認証必須のため、あえて認証なしで叩いて
 * 「拒否が返ること」を正常とみなす。到達性と認証の働きを、
 * 認証情報を持たずに確認できる（実際に会話できるかは別のカナリアで見る）。
 */
interface Target {
  name: string;
  url: string;
  method?: string;
  /** 正常とみなす HTTP ステータス */
  expectStatus: number[];
}

interface CheckResult {
  name: string;
  ok: boolean;
  status?: number;
  detail?: string;
  durationMs: number;
}

async function check(target: Target): Promise<CheckResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(target.url, {
      method: target.method ?? 'GET',
      signal: controller.signal,
      // 認証なしで叩くため、本文は最小限にする
      ...(target.method === 'POST' ? { body: '{}', headers: { 'Content-Type': 'application/json' } } : {}),
    });

    const ok = target.expectStatus.includes(response.status);
    return {
      name: target.name,
      ok,
      status: response.status,
      durationMs: Date.now() - startedAt,
      detail: ok
        ? undefined
        : `期待した応答は ${target.expectStatus.join('/')} ですが ${response.status} が返りました`,
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      name: target.name,
      ok: false,
      durationMs: Date.now() - startedAt,
      detail: aborted ? `${TIMEOUT_MS}ms 以内に応答がありませんでした` : '接続できませんでした',
    };
  } finally {
    clearTimeout(timer);
  }
}

export const handler = async (): Promise<{ results: CheckResult[] }> => {
  const targets = JSON.parse(TARGETS) as Target[];
  const results = await Promise.all(targets.map(check));

  // 監視結果はメトリクスにする。アラーム側でしきい値と連続回数を決める
  await cloudwatch.send(
    new PutMetricDataCommand({
      Namespace: METRIC_NAMESPACE,
      MetricData: results.flatMap((result) => [
        {
          MetricName: 'HealthCheckFailed',
          Dimensions: [{ Name: 'Target', Value: result.name }],
          Value: result.ok ? 0 : 1,
          Unit: 'Count' as const,
        },
        {
          MetricName: 'HealthCheckLatency',
          Dimensions: [{ Name: 'Target', Value: result.name }],
          Value: result.durationMs,
          Unit: 'Milliseconds' as const,
        },
      ]),
    }),
  );

  for (const result of results) {
    if (!result.ok) {
      console.error(
        JSON.stringify({
          level: 'ERROR',
          action: 'healthCheck',
          target: result.name,
          status: result.status,
          detail: result.detail,
        }),
      );
    }
  }

  return { results };
};
