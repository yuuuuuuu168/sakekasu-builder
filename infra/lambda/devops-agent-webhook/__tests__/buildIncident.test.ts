import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * SNS のアラームを DevOps Agent の調査依頼に組み立てる部分を検証する。
 * ハンドラは環境変数を要求するため、読み込み前に用意しておく。
 */
process.env.WEBHOOK_SECRET_ID = 'test/devops-agent/webhook';
process.env.ENV_NAME = 'dev';
process.env.SELF_ALARM_NAME = 'dev-sakekasu-devops-agent-webhook-failure';
process.env.SERVICE_NAME = 'sakekasu-builder';

/** Secrets Manager が返す中身。鍵の入れ替えを再現するためテストから差し替える */
const secretState = vi.hoisted(() => ({
  value: JSON.stringify({
    webhookUrl: 'https://event-ai.example/webhook/generic/test',
    signingSecret: 'secret',
  }),
}));
const DEFAULT_SECRET = secretState.value;

// Webhook の設定取得で AWS を呼びに行かせない
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send = async () => ({ SecretString: secretState.value });
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

function healthEvent(category: string, detailOverrides: Record<string, unknown> = {}): string {
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
      ...detailOverrides,
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

  it('RFC-1123 で届く startTime を ISO-8601 に直して送る', async () => {
    // AWS Health の時刻はこの形式で届く。そのまま渡すと受け取り側の解釈に委ねることになる
    const sent = await forward(healthEvent('issue', { startTime: 'Fri, 27 Jan 2023 06:02:51 GMT' }));

    expect(sent!.incident.timestamp).toBe('2023-01-27T06:02:51.000Z');
  });

  it('日時として読めない startTime はイベントの発生時刻で代用する', async () => {
    const sent = await forward(healthEvent('issue', { startTime: 'いつか' }));

    // event.time（2026-08-09T02:50:00Z）に落ちる。こちらも ISO に揃える
    expect(sent!.incident.timestamp).toBe('2026-08-09T02:50:00.000Z');
  });

  it('障害のリージョンは eventRegion を使う（配信元の region ではない）', async () => {
    // グローバルなサービスの障害は us-east-1 から転送されてくるため、
    // event.region を信じると「東京の障害」と読めてしまう
    const sent = await forward(healthEvent('issue', { service: 'CLOUDFRONT', eventRegion: 'global' }));

    expect(sent!.incident.description).toContain('global');
    expect(sent!.incident.description).not.toContain('ap-northeast-1');
  });

  it('eventRegion が無ければ配信元の region で代用する', async () => {
    const sent = await forward(healthEvent('issue'));

    expect(sent!.incident.description).toContain('ap-northeast-1');
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

  it('監視の停止は対象がソムリエでも MEDIUM にする（壊れているのは監視の側）', () => {
    // 名前に sommelier を含むため、順に見ると「ソムリエの故障」で HIGH に落ちてしまう
    expect(mod.priorityForAlarm('dev-sakekasu-watcher-failure-sommelier-canary')).toBe('MEDIUM');
    expect(mod.priorityForAlarm('dev-sakekasu-watcher-silent-sommelier-canary')).toBe('MEDIUM');
  });

  it('ソムリエ本体のカナリアは HIGH のまま（監視の停止と取り違えない）', () => {
    expect(mod.priorityForAlarm('dev-sakekasu-sommelier-canary')).toBe('HIGH');
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

describe('本文の長さ', () => {
  it('長すぎる自由記述は切って、切ったことを残す', () => {
    expect(mod.clip('あ'.repeat(10), 10)).toBe('あ'.repeat(10));
    expect(mod.clip('あ'.repeat(11), 10)).toBe(`${'あ'.repeat(10)}…（以下省略）`);
  });

  it('アラームの説明文が長くても本文が際限なく膨らまない', async () => {
    // 本文を読むのはエージェント（LLM）なので、調査の指示を押しのけさせない
    const sent = await forward(
      alarmMessage({ AlarmDescription: 'x'.repeat(5000), NewStateReason: 'y'.repeat(5000) }),
    );

    expect(sent!.incident.description.length).toBeLessThanOrEqual(4100);
    expect(sent!.incident.description).toContain('（以下省略）');
    // 切るのは本文だけ。エージェントが自分で読み解く生データは残す
    expect((sent!.incident.data.alarm as { AlarmDescription: string }).AlarmDescription).toHaveLength(
      5000,
    );
  });
});

describe('toIsoTimestamp', () => {
  it('RFC-1123 とオフセット付きの表記を ISO-8601 に揃える', () => {
    expect(mod.toIsoTimestamp('Fri, 27 Jan 2023 06:02:51 GMT')).toBe('2023-01-27T06:02:51.000Z');
    expect(mod.toIsoTimestamp('2026-08-09T08:00:00.000+0000')).toBe('2026-08-09T08:00:00.000Z');
  });

  it('日時として読めない値と空の値は undefined にする（呼び出し側の代替に任せる）', () => {
    expect(mod.toIsoTimestamp('いつか')).toBeUndefined();
    expect(mod.toIsoTimestamp(undefined)).toBeUndefined();
    expect(mod.toIsoTimestamp('')).toBeUndefined();
  });
});

describe('assertHttpsUrl', () => {
  it('https ならそのまま通す', () => {
    expect(mod.assertHttpsUrl('https://event-ai.example/webhook/generic/test')).toBe(
      'https://event-ai.example/webhook/generic/test',
    );
  });

  it('https 以外は送る前に弾く', () => {
    expect(() => mod.assertHttpsUrl('http://event-ai.example/webhook')).toThrow(/https/);
    expect(() => mod.assertHttpsUrl('file:///etc/passwd')).toThrow(/https/);
  });

  it('URL として読めない値も弾き、値そのものはメッセージに残さない', () => {
    expect(() => mod.assertHttpsUrl('だいたいこのへん')).toThrow(/URL として読めません/);
    expect(() => mod.assertHttpsUrl('だいたいこのへん')).not.toThrow(/だいたいこのへん/);
  });
});

/**
 * 設定のキャッシュは実行環境をまたいで残るため、時計を進めて期限切れを起こす。
 * 実タイマーまで差し替えると fetch の中断制御に影響するので Date だけ偽装する
 */
describe('Webhook 設定のキャッシュ', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterAll(() => {
    vi.useRealTimers();
    secretState.value = DEFAULT_SECRET;
  });

  it('期限が切れるまでは読み直さず、切れたら新しい鍵で署名する', async () => {
    secretState.value = JSON.stringify({
      webhookUrl: 'https://event-ai.example/webhook/generic/test',
      signingSecret: 'rotated',
    });

    // 期限内は前の鍵のまま（発報のたびに Secrets Manager を叩かない）
    const during = await forward(alarmMessage());
    expect(during!.headers['x-amzn-event-signature']).toBe(
      mod.sign(
        during!.headers['x-amzn-event-timestamp'],
        JSON.stringify(during!.incident),
        'secret',
      ),
    );

    vi.setSystemTime(Date.now() + 6 * 60 * 1000);

    // 期限が切れたら読み直す。鍵を入れ替えたあと古い鍵で署名し続けない
    const after = await forward(alarmMessage());
    expect(after!.headers['x-amzn-event-signature']).toBe(
      mod.sign(
        after!.headers['x-amzn-event-timestamp'],
        JSON.stringify(after!.incident),
        'rotated',
      ),
    );
  });

  it('設定が JSON でないとき、中身をメッセージに載せない', async () => {
    secretState.value = 'https://event-ai.example/webhook/generic/test';
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);

    // JSON.parse の例外は読めなかった中身の先頭を載せるため、握らないと URL や鍵がログに出る
    const run = mod.handler({
      Records: [{ Sns: { Message: alarmMessage(), Timestamp: SNS_TIMESTAMP } }],
    });

    await expect(run).rejects.toThrow(/JSON として読めません/);
    await expect(run).rejects.toThrow(/^(?!.*event-ai\.example).*$/s);
  });
});
