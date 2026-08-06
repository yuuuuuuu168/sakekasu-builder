import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssmClient = new SSMClient({});

/** Webhook URL を置いた SSM パラメータ名 */
const WEBHOOK_PARAMETER_NAME = process.env.WEBHOOK_PARAMETER_NAME!;
/** 通知に添えるコンソールのリージョン */
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';

/** Webhook URL は取得のたびに SSM を呼ばず、実行環境が生きている間は使い回す */
let cachedWebhookUrl: string | null = null;

interface SnsEventRecord {
  Sns: {
    Subject?: string | null;
    Message: string;
    Timestamp: string;
  };
}

interface SnsEvent {
  Records: SnsEventRecord[];
}

/** CloudWatch アラームが SNS に流す本文（必要な項目だけ） */
interface AlarmMessage {
  AlarmName?: string;
  AlarmDescription?: string | null;
  NewStateValue?: string;
  OldStateValue?: string;
  NewStateReason?: string;
  StateChangeTime?: string;
  Region?: string;
  Trigger?: {
    MetricName?: string;
    Namespace?: string;
    Threshold?: number;
    ComparisonOperator?: string;
    EvaluationPeriods?: number;
    Period?: number;
  };
}

/** AWS Health が EventBridge に流すイベント（使う項目だけ） */
interface HealthEvent {
  source?: string;
  region?: string;
  time?: string;
  detail?: {
    service?: string;
    eventTypeCode?: string;
    eventTypeCategory?: string;
    startTime?: string;
    endTime?: string;
    eventDescription?: { language?: string; latestDescription?: string }[];
    affectedEntities?: { entityValue?: string }[];
  };
}

function isHealthEvent(value: unknown): value is HealthEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as HealthEvent).source === 'aws.health'
  );
}

async function getWebhookUrl(): Promise<string> {
  if (cachedWebhookUrl) return cachedWebhookUrl;

  const result = await ssmClient.send(
    new GetParameterCommand({ Name: WEBHOOK_PARAMETER_NAME, WithDecryption: true }),
  );
  const value = result.Parameter?.Value;
  if (!value) {
    throw new Error(`Webhook URL が未設定です: ${WEBHOOK_PARAMETER_NAME}`);
  }
  cachedWebhookUrl = value;
  return value;
}

/** 状態に応じた見出し。復旧も通知して「直ったかどうか」が分かるようにする */
function headline(state: string | undefined, alarmName: string): string {
  switch (state) {
    case 'ALARM':
      return `🚨 異常を検知しました: ${alarmName}`;
    case 'OK':
      return `✅ 復旧しました: ${alarmName}`;
    case 'INSUFFICIENT_DATA':
      return `⚠️ データ不足で判定できません: ${alarmName}`;
    default:
      return `通知: ${alarmName}`;
  }
}

function alarmConsoleUrl(alarmName: string, region: string): string {
  return (
    `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}` +
    `#alarmsV2:alarm/${encodeURIComponent(alarmName)}`
  );
}

/** JST での表示。運用しているのが日本時間のため */
function formatJst(iso: string | undefined): string {
  if (!iso) return '不明';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(date);
}

/**
 * アラーム本文を Slack のブロックに組み立てる。
 * 何が起きたかと、次にどこを見ればよいかが1画面で分かることを優先する。
 */
function buildAlarmBlocks(alarm: AlarmMessage, fallbackTime: string): unknown[] {
  const alarmName = alarm.AlarmName ?? '(名称不明)';
  const region = alarm.Region && /^[a-z0-9-]+$/.test(alarm.Region) ? alarm.Region : REGION;

  const fields = [
    `*状態*\n${alarm.OldStateValue ?? '?'} → ${alarm.NewStateValue ?? '?'}`,
    `*発生時刻*\n${formatJst(alarm.StateChangeTime ?? fallbackTime)}`,
  ];
  if (alarm.Trigger?.MetricName) {
    fields.push(`*メトリクス*\n${alarm.Trigger.Namespace ?? ''} / ${alarm.Trigger.MetricName}`);
  }
  if (typeof alarm.Trigger?.Threshold === 'number') {
    fields.push(`*しきい値*\n${alarm.Trigger.Threshold}`);
  }

  const blocks: unknown[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: headline(alarm.NewStateValue, alarmName), emoji: true },
    },
    {
      type: 'section',
      fields: fields.map((text) => ({ type: 'mrkdwn', text })),
    },
  ];

  if (alarm.AlarmDescription) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*内容*\n${alarm.AlarmDescription}` },
    });
  }
  if (alarm.NewStateReason) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: alarm.NewStateReason.slice(0, 500) }],
    });
  }
  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `<${alarmConsoleUrl(alarmName, region)}|CloudWatch でアラームを開く>` },
    ],
  });

  return blocks;
}

/** Health イベントの種類。英語のコードだけでは伝わらないので日本語を添える */
const HEALTH_CATEGORY_LABEL: Record<string, string> = {
  issue: '障害',
  scheduledChange: '予定された変更',
  accountNotification: 'お知らせ',
  investigation: '調査中',
};

/**
 * AWS Health のイベントを組み立てる。
 * AWS 側の都合で起きる事象なので、こちらで直せるものではない。
 * 「何が・いつ・自分のどのリソースに影響するか」が分かることを優先する
 */
function buildHealthBlocks(event: HealthEvent): unknown[] {
  const detail = event.detail ?? {};
  const category = detail.eventTypeCategory ?? '';
  const categoryLabel = HEALTH_CATEGORY_LABEL[category] ?? category;
  const service = detail.service ?? '不明';
  const icon = category === 'issue' ? '🔥' : category === 'scheduledChange' ? '🗓️' : 'ℹ️';

  const fields = [
    `*サービス*\n${service}`,
    `*種類*\n${categoryLabel}`,
    `*リージョン*\n${event.region ?? '不明'}`,
    `*開始*\n${formatJst(detail.startTime ?? event.time)}`,
  ];
  if (detail.endTime) {
    fields.push(`*終了*\n${formatJst(detail.endTime)}`);
  }

  const blocks: unknown[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${icon} AWS からの通知: ${service}（${categoryLabel}）`,
        emoji: true,
      },
    },
    { type: 'section', fields: fields.map((text) => ({ type: 'mrkdwn', text })) },
  ];

  if (detail.eventTypeCode) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `\`${detail.eventTypeCode}\`` }],
    });
  }

  // 本文は英語で長いことがあるため、頭の方だけ載せて詳細はコンソールへ誘導する
  const description = detail.eventDescription?.[0]?.latestDescription;
  if (description) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: description.slice(0, 1500) },
    });
  }

  // 自分のどのリソースが対象かは、真っ先に知りたい情報
  const entities = (detail.affectedEntities ?? [])
    .map((e) => e.entityValue)
    .filter((v): v is string => !!v);
  if (entities.length > 0) {
    const shown = entities.slice(0, 10).join(', ');
    const rest = entities.length > 10 ? ` ほか${entities.length - 10}件` : '';
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*影響を受けるリソース*\n${shown}${rest}` },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: '<https://health.aws.amazon.com/health/home|AWS Health Dashboard を開く>',
      },
    ],
  });

  return blocks;
}

/** アラーム形式でない通知（外形監視からの任意メッセージなど）はそのまま流す */
function buildPlainBlocks(subject: string | null | undefined, message: string): unknown[] {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: subject ?? 'お知らせ', emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: message.slice(0, 2900) },
    },
  ];
}

async function postToSlack(blocks: unknown[], fallbackText: string): Promise<void> {
  const webhookUrl = await getWebhookUrl();

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: fallbackText, blocks }),
  });

  if (!response.ok) {
    // 本文には Webhook URL を含めない（ログに出さない）
    throw new Error(`Slack への送信に失敗しました (HTTP ${response.status})`);
  }
}

export const handler = async (event: SnsEvent): Promise<void> => {
  for (const record of event.Records) {
    const { Subject, Message, Timestamp } = record.Sns;

    let blocks: unknown[];
    let fallbackText: string;

    try {
      const parsed: unknown = JSON.parse(Message);
      if (isHealthEvent(parsed)) {
        blocks = buildHealthBlocks(parsed);
        const service = parsed.detail?.service ?? '不明';
        const category = parsed.detail?.eventTypeCategory ?? '';
        fallbackText = `AWS からの通知: ${service}（${HEALTH_CATEGORY_LABEL[category] ?? category}）`;
      } else if (parsed && typeof parsed === 'object' && (parsed as AlarmMessage).AlarmName) {
        const alarm = parsed as AlarmMessage;
        blocks = buildAlarmBlocks(alarm, Timestamp);
        fallbackText = headline(alarm.NewStateValue, alarm.AlarmName!);
      } else {
        blocks = buildPlainBlocks(Subject, Message);
        fallbackText = Subject ?? 'お知らせ';
      }
    } catch {
      // JSON でない本文はそのまま通知する
      blocks = buildPlainBlocks(Subject, Message);
      fallbackText = Subject ?? 'お知らせ';
    }

    await postToSlack(blocks, fallbackText);
  }
};
