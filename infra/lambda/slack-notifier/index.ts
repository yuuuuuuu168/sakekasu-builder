import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import {
  SLACK_HEADER_LIMIT,
  SLACK_TEXT_LIMIT,
  clip,
  createWebhookUrlGetter,
  dropBrokenCharacters,
  escapeMrkdwn,
  postToSlack as postToWebhook,
  safeText,
} from '../shared/slack';

const ssmClient = new SSMClient({});

/** Webhook URL を置いた SSM パラメータ名 */
const WEBHOOK_PARAMETER_NAME = process.env.WEBHOOK_PARAMETER_NAME!;
/** 通知に添えるコンソールのリージョン */
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';

const getWebhookUrl = createWebhookUrlGetter(async () => {
  const result = await ssmClient.send(
    new GetParameterCommand({ Name: WEBHOOK_PARAMETER_NAME, WithDecryption: true }),
  );
  return result.Parameter?.Value;
}, WEBHOOK_PARAMETER_NAME);

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
    eventArn?: string;
    eventRegion?: string;
    eventScopeCode?: string;
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

/**
 * 状態に応じた見出し。復旧も通知して「直ったかどうか」が分かるようにする。
 *
 * ここでは加工しない素の文字列を返す。見出し（plain_text）は記法を解釈しないので
 * エスケープすると実体参照がそのまま見えてしまい、通知プレビュー（mrkdwn）には
 * エスケープが要る、と用途で必要な処理が違うため
 */
function headline(state: string | undefined, rawAlarmName: string): string {
  const alarmName = clip(rawAlarmName, 200);
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
  // URL 生成にも使うため、ここで壊れた文字を落としておく
  // （encodeURIComponent は対になっていないサロゲートで例外を投げる）
  const alarmName = dropBrokenCharacters(alarm.AlarmName ?? '(名称不明)');
  const region = alarm.Region && /^[a-z0-9-]+$/.test(alarm.Region) ? alarm.Region : REGION;

  const fields = [
    `*状態*\n${safeText(`${alarm.OldStateValue ?? '?'} → ${alarm.NewStateValue ?? '?'}`, 100)}`,
    `*発生時刻*\n${safeText(formatJst(alarm.StateChangeTime ?? fallbackTime), 100)}`,
  ];
  if (alarm.Trigger?.MetricName) {
    fields.push(
      `*メトリクス*\n${safeText(`${alarm.Trigger.Namespace ?? ''} / ${alarm.Trigger.MetricName}`, 200)}`,
    );
  }
  if (typeof alarm.Trigger?.Threshold === 'number') {
    fields.push(`*しきい値*\n${alarm.Trigger.Threshold}`);
  }

  const blocks: unknown[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        // 見出しは 150 文字を超えると送信ごと失敗する
        text: clip(headline(alarm.NewStateValue, alarmName), SLACK_HEADER_LIMIT),
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: fields.map((text) => ({ type: 'mrkdwn', text })),
    },
  ];

  if (alarm.AlarmDescription) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*内容*\n${safeText(alarm.AlarmDescription, 1500)}` },
    });
  }
  if (alarm.NewStateReason) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: safeText(alarm.NewStateReason, 500) }],
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
    `*サービス*\n${safeText(service, 200)}`,
    `*種類*\n${safeText(categoryLabel, 100)}`,
    `*リージョン*\n${safeText(event.region ?? '不明', 100)}`,
    `*開始*\n${safeText(formatJst(detail.startTime ?? event.time), 100)}`,
  ];
  if (detail.endTime) {
    fields.push(`*終了*\n${safeText(formatJst(detail.endTime), 100)}`);
  }

  const blocks: unknown[] = [
    {
      type: 'header',
      text: {
        // plain_text は記法として解釈されないが、長さだけは抑えておく
        type: 'plain_text',
        text: clip(`${icon} AWS からの通知: ${service}（${categoryLabel}）`, SLACK_HEADER_LIMIT),
        emoji: true,
      },
    },
    { type: 'section', fields: fields.map((text) => ({ type: 'mrkdwn', text })) },
  ];

  if (detail.eventTypeCode) {
    // バックティックが混ざるとコード表記が崩れるので落としておく
    const code = safeText(detail.eventTypeCode.replace(/`/g, "'"), 200);
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `\`${code}\`` }],
    });
  }

  // 本文は英語で長いことがあるため、頭の方だけ載せて詳細はコンソールへ誘導する
  const description = detail.eventDescription?.[0]?.latestDescription;
  if (description) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: safeText(description, 1500) },
    });
  }

  // 自分のどのリソースが対象かは、真っ先に知りたい情報。
  // ただし ARN は1件で最大2048文字あり、数件並べるだけで Slack の上限を超える。
  // 超えると送信そのものが失敗して通知が届かなくなるため、入る分だけ載せる
  const entities = (detail.affectedEntities ?? [])
    .map((e) => e.entityValue)
    .filter((v): v is string => !!v);
  if (entities.length > 0) {
    const budget = SLACK_TEXT_LIMIT - 100;
    const shown: string[] = [];
    let used = 0;
    for (const entity of entities) {
      const piece = escapeMrkdwn(entity);
      if (used + piece.length + 2 > budget) break;
      shown.push(piece);
      used += piece.length + 2;
    }
    const omitted = entities.length - shown.length;
    const rest = omitted > 0 ? ` ほか${omitted}件` : '';
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*影響を受けるリソース*\n${shown.join(', ')}${rest}` },
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
      text: { type: 'plain_text', text: clip(subject ?? 'お知らせ', SLACK_HEADER_LIMIT), emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: safeText(message) },
    },
  ];
}

async function postToSlack(blocks: unknown[], fallbackText: string): Promise<void> {
  await postToWebhook(await getWebhookUrl(), blocks, fallbackText);
}

/**
 * 受け取った Health イベントをログに残す。
 *
 * Slack に流すだけだと、後から「何が届いたのか」を AWS 側から追えない。
 * Health API（describe-events）は Business 以上のサポート契約がないと呼べず、
 * EventBridge も既定ではイベントを保存しないため、通知が流れたあとは
 * Slack の画面が唯一の記録になってしまう。実際 2026-08-21 の Connect の
 * 障害通知では、中身を確かめるのにスクリーンショットが要った。
 *
 * アラームの方は CloudWatch のアラーム履歴に残るので、ここでは Health だけ書き出す。
 */
function logHealthEvent(event: HealthEvent): void {
  const detail = event.detail ?? {};
  console.log(
    JSON.stringify({
      kind: 'aws-health-event',
      service: detail.service,
      eventArn: detail.eventArn,
      eventTypeCode: detail.eventTypeCode,
      eventTypeCategory: detail.eventTypeCategory,
      // PUBLIC はリージョン全体の公開情報で、こちらのリソースに影響するとは限らない。
      // 使っていないサービスの通知が届いたときの切り分けに要る
      eventScopeCode: detail.eventScopeCode,
      // region は通知の配信先。実際に影響を受けたのは eventRegion の方
      eventRegion: detail.eventRegion ?? event.region,
      startTime: detail.startTime,
      endTime: detail.endTime,
      affectedEntityCount: (detail.affectedEntities ?? []).length,
      // 本文は数千文字になることがあるので頭だけ残す
      description: clip(detail.eventDescription?.[0]?.latestDescription ?? '', 1000),
    }),
  );
}

export const handler = async (event: SnsEvent): Promise<void> => {
  for (const record of event.Records) {
    const { Subject, Message, Timestamp } = record.Sns;

    let blocks: unknown[];
    let fallbackText: string;

    try {
      const parsed: unknown = JSON.parse(Message);
      if (isHealthEvent(parsed)) {
        // Slack 送信より先に出す。送信に失敗しても記録は残したい
        logHealthEvent(parsed);
        blocks = buildHealthBlocks(parsed);
        const service = parsed.detail?.service ?? '不明';
        const category = parsed.detail?.eventTypeCategory ?? '';
        // 無害化は送信の直前で一度だけ行う（二重に通すと表示が壊れる）
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
