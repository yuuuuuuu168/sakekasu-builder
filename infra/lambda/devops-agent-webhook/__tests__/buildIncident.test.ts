import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * SNS のアラームを DevOps Agent の調査依頼に組み立てる部分を検証する。
 * ハンドラは環境変数を要求するため、読み込み前に用意しておく。
 */
process.env.WEBHOOK_SECRET_ID = 'test/devops-agent/webhook';
process.env.ENV_NAME = 'dev';
process.env.SELF_ALARM_NAME = 'dev-sakekasu-devops-agent-webhook-failure';
process.env.SERVICE_NAME = 'sakekasu-builder';

// Webhook の設定取得で AWS を呼びに行かせない
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send = async () => ({
      SecretString: JSON.stringify({
        webhookUrl: 'https://event-ai.example/webhook/generic/test',
        signingSecret: 'secret',
      }),
    });
  },
  GetSecretValueCommand: class {
    constructor(public input: unknown) {}
  },
}));

const SNS_TIMESTAMP = '2026-08-09T03:00:00.000Z';

interface IncidentPayload {
  eventType: string;
  incidentId: string;
  action: string;
  priority: string;
  title: string;
  description: string;
  timestamp: string;
  service: string;
  data: Record<string, unknown>;
}

let mod: typeof import('../index.ts');
/** ハンドラに1件流し、Webhook へ送られた本文とヘッダーを取り出す（送らなければ null） */
let forward: (message: string) => Promise<{ incident: IncidentPayload; headers: Record<string, string> } | null>;

beforeAll(async () => {
  mod = await import('../index.ts');

  forward = async (message) => {
    let captured: { incident: IncidentPayload; headers: Record<string, string> } | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { body: string; headers: Record<string, string> }) => {
      captured = { incident: JSON.parse(init.body) as IncidentPayload, headers: init.headers };
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;
    try {
      await mod.handler({
        Records: [{ Sns: { Message: message, Timestamp: SNS_TIMESTAMP } }],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    return captured;
  };
});

function alarmMessage(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    AlarmName: 'dev-sakekasu-appsync-5xx',
    AlarmDescription: 'GraphQL API がサーバエラーを返しています',
    NewStateValue: 'ALARM',
    OldStateValue: 'OK',
    NewStateReason: 'Threshold Crossed: 1 datapoint [7.0] was greater than the threshold (5.0).',
    StateChangeTime: '2026-08-09T02:59:30.000Z',
    Region: 'Asia Pacific (Tokyo)',
    AWSAccountId: '232791540685',
    Trigger: {
      MetricName: '5XXError',
      Namespace: 'AWS/AppSync',
      Threshold: 5,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
    },
    ...overrides,
  });
}

function healthEvent(category: string): string {
  return JSON.stringify({
    source: 'aws.health',
    region: 'ap-northeast-1',
    time: '2026-08-09T02:50:00Z',
    detail: {
      service: 'DYNAMODB',
      eventArn: 'arn:aws:health:ap-northeast-1::event/DYNAMODB/AWS_DYNAMODB_OPERATIONAL_ISSUE/abc',
      eventTypeCode: 'AWS_DYNAMODB_OPERATIONAL_ISSUE',
      eventTypeCategory: category,
      startTime: '2026-08-09T02:45:00Z',
      eventDescription: [{ latestDescription: 'We are investigating increased error rates.' }],
      affectedEntities: [{ entityValue: 'dev-sakekasu-purchases' }],
    },
  });
}

describe('CloudWatch アラームの転送', () => {
  it('発報したアラームを調査依頼に組み立てて送る', async () => {
    const sent = await forward(alarmMessage());

    expect(sent).not.toBeNull();
    expect(sent!.incident.eventType).toBe('incident');
    expect(sent!.incident.action).toBe('created');
    expect(sent!.incident.title).toBe('CloudWatch アラーム: dev-sakekasu-appsync-5xx');
    // 発報の時刻はアラーム側のものを使う（SNS の受信時刻ではない）
    expect(sent!.incident.timestamp).toBe('2026-08-09T02:59:30.000Z');
    expect(sent!.incident.service).toBe('sakekasu-builder');
  });

  it('調査の材料になる情報を本文に入れる', async () => {
    const sent = await forward(alarmMessage());

    expect(sent!.incident.description).toContain('GraphQL API がサーバエラーを返しています');
    expect(sent!.incident.description).toContain('Threshold Crossed');
    expect(sent!.incident.description).toContain('AWS/AppSync / 5XXError');
    expect(sent!.incident.description).toContain('232791540685');
    // 環境が分からないと調査先を間違えるため必ず添える
    expect(sent!.incident.description).toContain('dev 環境');
  });

  it('元のイベントをそのまま添える', async () => {
    const sent = await forward(alarmMessage());

    expect(sent!.incident.data).toMatchObject({
      source: 'cloudwatch-alarm',
      envName: 'dev',
      alarm: { AlarmName: 'dev-sakekasu-appsync-5xx' },
    });
  });

  it('HMAC 署名とタイムスタンプを同じ値で送る', async () => {
    const sent = await forward(alarmMessage());
    const { headers, incident } = sent!;
    const timestamp = headers['x-amzn-event-timestamp'];

    expect(headers['Content-Type']).toBe('application/json');
    expect(timestamp).toBeTruthy();
    // 署名の対象は「そのヘッダーの時刻」と「実際に送った本文」
    expect(headers['x-amzn-event-signature']).toBe(
      mod.sign(timestamp, JSON.stringify(incident), 'secret'),
    );
  });

  it('復旧（OK）では調査を起こさない', async () => {
    const sent = await forward(alarmMessage({ NewStateValue: 'OK', OldStateValue: 'ALARM' }));

    expect(sent).toBeNull();
  });

  it('データ不足でも調査を起こさない', async () => {
    const sent = await forward(alarmMessage({ NewStateValue: 'INSUFFICIENT_DATA' }));

    expect(sent).toBeNull();
  });

  it('転送の失敗を転送し返さない（届かないことを届けようとしない）', async () => {
    const sent = await forward(
      alarmMessage({ AlarmName: 'dev-sakekasu-devops-agent-webhook-failure' }),
    );

    expect(sent).toBeNull();
  });

  it('アラームでも Health イベントでもない本文は転送しない', async () => {
    expect(await forward(JSON.stringify({ hello: 'world' }))).toBeNull();
  });

  it('JSON でない本文は転送しない', async () => {
    expect(await forward('ただのお知らせです')).toBeNull();
  });

  it('状態が変わった時刻が無ければ SNS の受信時刻で代用する', async () => {
    const sent = await forward(alarmMessage({ StateChangeTime: undefined }));

    expect(sent!.incident.timestamp).toBe(SNS_TIMESTAMP);
  });
});

describe('AWS Health の転送', () => {
  it('障害イベントは調査に回す', async () => {
    const sent = await forward(healthEvent('issue'));

    expect(sent).not.toBeNull();
    expect(sent!.incident.title).toBe('AWS Health 障害: DYNAMODB');
    expect(sent!.incident.priority).toBe('HIGH');
    expect(sent!.incident.description).toContain('AWS_DYNAMODB_OPERATIONAL_ISSUE');
    expect(sent!.incident.description).toContain('dev-sakekasu-purchases');
    // イベント ARN はイベントごとに一意なので、そのまま識別子に使える
    expect(sent!.incident.incidentId).toContain('AWS_DYNAMODB_OPERATIONAL_ISSUE');
  });

  it('予定された変更では調査を起こさない', async () => {
    expect(await forward(healthEvent('scheduledChange'))).toBeNull();
  });
});

describe('priorityForAlarm', () => {
  it('利用者がサイトを使えないものは最優先にする', () => {
    expect(mod.priorityForAlarm('dev-sakekasu-health-check-frontend')).toBe('CRITICAL');
    expect(mod.priorityForAlarm('dev-sakekasu-appsync-5xx')).toBe('CRITICAL');
  });

  it('主要機能の故障は HIGH にする', () => {
    expect(mod.priorityForAlarm('dev-sakekasu-sommelier-system-errors')).toBe('HIGH');
    expect(mod.priorityForAlarm('dev-sakekasu-ocr-errors')).toBe('HIGH');
  });

  it('利用者から見えない失敗は MEDIUM にする', () => {
    expect(mod.priorityForAlarm('dev-sakekasu-signup-notify-fail')).toBe('MEDIUM');
    expect(mod.priorityForAlarm('dev-sakekasu-watcher-silent-health-check')).toBe('MEDIUM');
  });

  it('表に無いアラームは HIGH に倒す（黙って埋もれさせない）', () => {
    expect(mod.priorityForAlarm('dev-sakekasu-unknown-alarm')).toBe('HIGH');
  });
});

describe('buildIncidentId', () => {
  it('同じ発報からは同じ識別子になる（再試行で調査が二重にならない）', async () => {
    const first = await forward(alarmMessage());
    const second = await forward(alarmMessage());

    expect(first!.incident.incidentId).toBe(second!.incident.incidentId);
  });

  it('2度目の発報は別の識別子になる（重複として捨てられない）', async () => {
    const first = await forward(alarmMessage());
    const second = await forward(alarmMessage({ StateChangeTime: '2026-08-09T05:00:00.000Z' }));

    expect(first!.incident.incidentId).not.toBe(second!.incident.incidentId);
  });

  it('英数と - _ . : 以外は落とし、長さも抑える', () => {
    expect(mod.buildIncidentId(['アラーム/名 前', '2026-08-09T03:00:00.000Z'])).toMatch(
      /^[A-Za-z0-9\-._:]+$/,
    );
    expect(mod.buildIncidentId(['x'.repeat(300)])).toHaveLength(200);
  });

  it('材料が空でも識別子は必ず返す', () => {
    expect(mod.buildIncidentId([undefined, ''])).toBe('unknown-incident');
  });
});

describe('sign', () => {
  it('タイムスタンプと本文を鍵で署名する（AWS のサンプルと同じ手順）', () => {
    // 手順: base64(HMAC-SHA256("<timestamp>:<payload>", secret))
    expect(mod.sign('2026-08-09T03:00:00.000Z', '{"a":1}', 'secret')).toBe(
      'Fy38bUSVU52r5+88o4qlmbopsNPQKO5lW7MBhjaUqiw=',
    );
  });

  it('本文が1文字でも変われば署名も変わる', () => {
    const a = mod.sign('2026-08-09T03:00:00.000Z', '{"a":1}', 'secret');
    const b = mod.sign('2026-08-09T03:00:00.000Z', '{"a":2}', 'secret');

    expect(a).not.toBe(b);
  });

  it('同じ本文でも時刻が違えば署名は変わる（再送を弾けるようにするため）', () => {
    const a = mod.sign('2026-08-09T03:00:00.000Z', '{"a":1}', 'secret');
    const b = mod.sign('2026-08-09T03:00:01.000Z', '{"a":1}', 'secret');

    expect(a).not.toBe(b);
  });
});

describe('Webhook が失敗したとき', () => {
  it('例外にして SNS の再試行とアラームに拾わせる', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: false, status: 500 }) as Response) as unknown as typeof fetch;
    try {
      await expect(
        mod.handler({ Records: [{ Sns: { Message: alarmMessage(), Timestamp: SNS_TIMESTAMP } }] }),
      ).rejects.toThrow('HTTP 500');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('失敗の本文に Webhook の URL や鍵を残さない', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: false, status: 403 }) as Response) as unknown as typeof fetch;
    try {
      await expect(
        mod.handler({ Records: [{ Sns: { Message: alarmMessage(), Timestamp: SNS_TIMESTAMP } }] }),
      ).rejects.toThrow(/^(?!.*(event-ai\.example|secret)).*$/s);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
