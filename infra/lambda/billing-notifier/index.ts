import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  type GetCostAndUsageCommandInput,
  type ResultByTime,
} from '@aws-sdk/client-cost-explorer';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

// Cost Explorer はグローバルサービスで、エンドポイントは us-east-1 にある
const costExplorerClient = new CostExplorerClient({ region: 'us-east-1' });
const ssmClient = new SSMClient({});

/** Webhook URL を置いた SSM パラメータ名 */
const WEBHOOK_PARAMETER_NAME = process.env.WEBHOOK_PARAMETER_NAME!;
/** 個別に表示するアカウント（JSON: [{ id, label }]）。先頭から順に表示する */
const TARGET_ACCOUNTS_JSON = process.env.TARGET_ACCOUNTS ?? '[]';

/** Webhook URL は取得のたびに SSM を呼ばず、実行環境が生きている間は使い回す */
let cachedWebhookUrl: string | null = null;

export interface TargetAccount {
  id: string;
  label: string;
}

/** 1アカウント分の集計。金額はすべて USD */
export interface AccountCost {
  /** クレジット適用前の利用額（Usage・Tax・Fee など Credit 以外の合計） */
  gross: number;
  /** クレジットで賄われた額（0 以下の値） */
  credit: number;
  /** 実際に請求される額（gross + credit） */
  net: number;
}

/** アカウント ID → 集計。合計は呼び出し側で全アカウントを足して出す */
export type CostsByAccount = Map<string, AccountCost>;

/** レポートが対象とする期間。日付は Cost Explorer に合わせて UTC 基準 */
export interface ReportPeriods {
  /** 昨日1日分: [start, end) */
  daily: { start: string; end: string };
  /** 月初からの累計: [start, end)。月初日の実行時は前月まるごとになる */
  monthly: { start: string; end: string };
  /** 月初日の実行で前月分を報告しているか（表示の見出しに使う） */
  isPreviousMonth: boolean;
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * 実行時刻から集計期間を決める。
 *
 * Cost Explorer は UTC の日単位で集計するため、期間も UTC で切る。
 * 月初日（UTC）は「今月累計」が空になるので、前月まるごとを報告する
 */
export function resolvePeriods(now: Date): ReportPeriods {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const isFirstDayOfMonth = today.getUTCDate() === 1;

  const monthStart = isFirstDayOfMonth
    ? new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), 1))
    : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

  return {
    daily: { start: toDateString(yesterday), end: toDateString(today) },
    monthly: { start: toDateString(monthStart), end: toDateString(today) },
    isPreviousMonth: isFirstDayOfMonth,
  };
}

/**
 * Cost Explorer の応答（LINKED_ACCOUNT × RECORD_TYPE のグループ）を
 * アカウントごとに集計する。
 *
 * クレジットは RECORD_TYPE が Credit の負の金額として現れる。
 * 「クレジットで賄われた分も見たい」という要件のため、
 * Credit だけを分離し、それ以外（Usage・Tax・Refund など）を利用額側に足す
 */
export function aggregateByAccount(results: ResultByTime[]): CostsByAccount {
  const costs: CostsByAccount = new Map();

  for (const result of results) {
    for (const group of result.Groups ?? []) {
      const [accountId, recordType] = group.Keys ?? [];
      if (!accountId) continue;

      const amount = Number(group.Metrics?.UnblendedCost?.Amount ?? '0');
      if (Number.isNaN(amount)) continue;

      const entry = costs.get(accountId) ?? { gross: 0, credit: 0, net: 0 };
      if (recordType === 'Credit') {
        entry.credit += amount;
      } else {
        entry.gross += amount;
      }
      entry.net = entry.gross + entry.credit;
      costs.set(accountId, entry);
    }
  }

  return costs;
}

/** "$12.34" / "-$0.12" の形式。Slack で桁が読みやすいよう2桁固定 */
export function formatUsd(amount: number): string {
  // -0.0001 のような誤差で "-$0.00" と表示されないよう丸めてから符号を見る
  const rounded = Math.round(amount * 100) / 100;
  const sign = rounded < 0 ? '-' : '';
  return `${sign}$${Math.abs(rounded).toFixed(2)}`;
}

function emptyCost(): AccountCost {
  return { gross: 0, credit: 0, net: 0 };
}

function sumCosts(costs: Iterable<AccountCost>): AccountCost {
  const total = emptyCost();
  for (const cost of costs) {
    total.gross += cost.gross;
    total.credit += cost.credit;
  }
  total.net = total.gross + total.credit;
  return total;
}

/** 指定アカウント以外（その他）の合計。組織にアカウントが増えても取りこぼさない */
function sumOtherAccounts(costs: CostsByAccount, targets: TargetAccount[]): AccountCost {
  const targetIds = new Set(targets.map((t) => t.id));
  const others = [...costs.entries()]
    .filter(([accountId]) => !targetIds.has(accountId))
    .map(([, cost]) => cost);
  return sumCosts(others);
}

/** 1アカウント分の表示。利用額・クレジット・請求額を1行ずつ並べる */
function costLines(monthly: AccountCost, daily: AccountCost): string {
  return [
    `昨日の利用額: ${formatUsd(daily.gross)}（クレジット ${formatUsd(daily.credit)}）`,
    `今月の利用額: ${formatUsd(monthly.gross)}`,
    `クレジット適用: ${formatUsd(monthly.credit)}`,
    `請求される額: *${formatUsd(monthly.net)}*`,
  ].join('\n');
}

/**
 * Slack へ送るブロックを組み立てる。
 * 値はすべて自前で整形した数値と定数ラベルのため、mrkdwn のエスケープは不要
 */
export function buildBlocks(
  targets: TargetAccount[],
  periods: ReportPeriods,
  monthlyCosts: CostsByAccount,
  dailyCosts: CostsByAccount,
): unknown[] {
  const monthLabel = periods.isPreviousMonth
    ? `${Number(periods.monthly.start.slice(5, 7))}月分（確定）`
    : `${Number(periods.monthly.start.slice(5, 7))}月 月初からの累計`;

  const blocks: unknown[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '💰 AWS 利用料金レポート', emoji: true },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text:
            `今月: ${monthLabel}（${periods.monthly.start} 〜 ${periods.monthly.end} UTC） / ` +
            `昨日: ${periods.daily.start}（UTC）。集計途中の概算です`,
        },
      ],
    },
  ];

  for (const target of targets) {
    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            `*${target.label}* \`${target.id}\`\n` +
            costLines(
              monthlyCosts.get(target.id) ?? emptyCost(),
              dailyCosts.get(target.id) ?? emptyCost(),
            ),
        },
      },
    );
  }

  // 指定外のアカウントに費用が出ていたら、気づけるように載せる
  const otherMonthly = sumOtherAccounts(monthlyCosts, targets);
  const otherDaily = sumOtherAccounts(dailyCosts, targets);
  if (otherMonthly.gross !== 0 || otherMonthly.credit !== 0 || otherDaily.gross !== 0) {
    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*その他のアカウント*\n${costLines(otherMonthly, otherDaily)}`,
        },
      },
    );
  }

  const totalMonthly = sumCosts(monthlyCosts.values());
  const totalDaily = sumCosts(dailyCosts.values());
  blocks.push(
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*組織全体の合計*\n${costLines(totalMonthly, totalDaily)}`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '<https://console.aws.amazon.com/costmanagement/home#/cost-explorer|Cost Explorer を開く>',
        },
      ],
    },
  );

  return blocks;
}

/** ページネーションを畳み込みながら全グループを取得する */
async function getCostAndUsage(
  input: Omit<GetCostAndUsageCommandInput, 'NextPageToken'>,
): Promise<ResultByTime[]> {
  const results: ResultByTime[] = [];
  let nextPageToken: string | undefined;

  do {
    const response = await costExplorerClient.send(
      new GetCostAndUsageCommand({ ...input, NextPageToken: nextPageToken }),
    );
    results.push(...(response.ResultsByTime ?? []));
    nextPageToken = response.NextPageToken;
  } while (nextPageToken);

  return results;
}

async function fetchCosts(period: { start: string; end: string }, granularity: 'DAILY' | 'MONTHLY') {
  const results = await getCostAndUsage({
    TimePeriod: { Start: period.start, End: period.end },
    Granularity: granularity,
    Metrics: ['UnblendedCost'],
    GroupBy: [
      { Type: 'DIMENSION', Key: 'LINKED_ACCOUNT' },
      { Type: 'DIMENSION', Key: 'RECORD_TYPE' },
    ],
  });
  return aggregateByAccount(results);
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

/**
 * 毎日の定期実行で、組織全体の利用料金を Slack へ通知する（Issue #92）。
 *
 * アカウント別の内訳（LINKED_ACCOUNT）を見られるのは管理アカウントだけのため、
 * この Lambda は Organization の管理アカウントで動かす。
 * 失敗はそのまま throw し、Lambda のエラーメトリクスのアラームで拾う
 */
export const handler = async (): Promise<void> => {
  const targets = JSON.parse(TARGET_ACCOUNTS_JSON) as TargetAccount[];
  const periods = resolvePeriods(new Date());

  const [monthlyCosts, dailyCosts] = await Promise.all([
    fetchCosts(periods.monthly, 'MONTHLY'),
    fetchCosts(periods.daily, 'DAILY'),
  ]);

  const blocks = buildBlocks(targets, periods, monthlyCosts, dailyCosts);
  const total = sumCosts(monthlyCosts.values());
  await postToSlack(blocks, `AWS 利用料金レポート: 今月の請求見込み ${formatUsd(total.net)}`);
};
