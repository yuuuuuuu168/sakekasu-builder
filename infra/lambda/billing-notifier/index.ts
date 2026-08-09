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

/** アカウント ID → サービス名 → クレジット適用前の利用額（USD） */
export type ServiceCostsByAccount = Map<string, Map<string, number>>;

/**
 * サービス別内訳の最大行数。「その他」に畳まず実サービス名でできるだけ載せる
 * 方針だが、Slack の section は 3000 文字で送信ごと失敗するため上限は設ける
 */
const MAX_SERVICE_LINES = 10;

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

/**
 * Cost Explorer の応答（LINKED_ACCOUNT × SERVICE のグループ）を
 * アカウントごと・サービスごとに集計する。クエリ側でクレジットを
 * 除外しているため、ここの値は「クレジット適用前の利用額」になる
 */
export function aggregateServicesByAccount(results: ResultByTime[]): ServiceCostsByAccount {
  const costs: ServiceCostsByAccount = new Map();

  for (const result of results) {
    for (const group of result.Groups ?? []) {
      const [accountId, service] = group.Keys ?? [];
      if (!accountId || !service) continue;

      const amount = Number(group.Metrics?.UnblendedCost?.Amount ?? '0');
      if (Number.isNaN(amount)) continue;

      const services = costs.get(accountId) ?? new Map<string, number>();
      services.set(service, (services.get(service) ?? 0) + amount);
      costs.set(accountId, services);
    }
  }

  return costs;
}

/** 全アカウントのサービス別費用を1つに合算する（組織全体の内訳用） */
export function sumServicesAcrossAccounts(costs: ServiceCostsByAccount): Map<string, number> {
  const total = new Map<string, number>();
  for (const services of costs.values()) {
    for (const [service, amount] of services) {
      total.set(service, (total.get(service) ?? 0) + amount);
    }
  }
  return total;
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
 * サービス名は AWS 由来の文字列のため、mrkdwn が解釈する文字だけ無害化する。
 * （例: "AWS Cost & Usage Report" のような & を含む名前がある）
 */
function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 利用料の多い順に、できるだけ実サービス名のまま並べる。
 * 「その他」に畳むのは、表示上 $0.00 になる端数と上限を超えた分だけ
 */
function serviceLines(services: Map<string, number>): string {
  const sorted = [...services.entries()].sort(([, a], [, b]) => b - a);
  const visible = sorted
    .filter(([, amount]) => Math.round(amount * 100) !== 0)
    .slice(0, MAX_SERVICE_LINES);

  if (visible.length === 0) return '_今月の利用はまだありません_';

  const visibleNames = new Set(visible.map(([service]) => service));
  const rest = sorted
    .filter(([service]) => !visibleNames.has(service))
    .reduce((sum, [, amount]) => sum + amount, 0);

  const lines = visible.map(
    ([service, amount], index) => `${index + 1}. ${escapeMrkdwn(service)}: ${formatUsd(amount)}`,
  );
  // 端数の集まりが表示上 $0.00 になる場合は載せない
  if (Math.round(rest * 100) !== 0) {
    lines.push(`その他: ${formatUsd(rest)}`);
  }
  return lines.join('\n');
}

/** 1セクション分（見出し＋費用サマリー＋上位サービス）を組み立てる */
function accountSection(
  title: string,
  monthly: AccountCost,
  daily: AccountCost,
  services: Map<string, number>,
): unknown {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text:
        `${title}\n` +
        `${costLines(monthly, daily)}\n` +
        `*サービス別内訳（今月・クレジット適用前・Tax 除く）*\n` +
        serviceLines(services),
    },
  };
}

/**
 * Slack へ送るブロックを組み立てる。
 * 組織全体の合計を先頭に置き、続けて指定アカウントを個別に載せる
 */
export function buildBlocks(
  targets: TargetAccount[],
  periods: ReportPeriods,
  monthlyCosts: CostsByAccount,
  dailyCosts: CostsByAccount,
  monthlyServices: ServiceCostsByAccount,
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

  // 組織全体の合計を先頭に。全アカウント分を足すので、
  // 個別表示していないアカウントの費用も取りこぼさない
  blocks.push(
    { type: 'divider' },
    accountSection(
      '*組織全体の合計*',
      sumCosts(monthlyCosts.values()),
      sumCosts(dailyCosts.values()),
      sumServicesAcrossAccounts(monthlyServices),
    ),
  );

  for (const target of targets) {
    blocks.push(
      { type: 'divider' },
      accountSection(
        `*${target.label}* \`${target.id}\``,
        monthlyCosts.get(target.id) ?? emptyCost(),
        dailyCosts.get(target.id) ?? emptyCost(),
        monthlyServices.get(target.id) ?? new Map(),
      ),
    );
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: '<https://console.aws.amazon.com/costmanagement/home#/cost-explorer|Cost Explorer を開く>',
      },
    ],
  });

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

/**
 * サービス別の内訳を取る。GroupBy は2次元までのため RECORD_TYPE を諦め、
 * 代わりにフィルターでクレジットを除外して「適用前の利用額」に揃える。
 * 税はサービスの利用状況を表さないため内訳からは外す（費用サマリーには含まれる）
 */
async function fetchServiceCosts(period: { start: string; end: string }) {
  const results = await getCostAndUsage({
    TimePeriod: { Start: period.start, End: period.end },
    Granularity: 'MONTHLY',
    Metrics: ['UnblendedCost'],
    GroupBy: [
      { Type: 'DIMENSION', Key: 'LINKED_ACCOUNT' },
      { Type: 'DIMENSION', Key: 'SERVICE' },
    ],
    Filter: {
      Not: { Dimensions: { Key: 'RECORD_TYPE', Values: ['Credit', 'Tax'] } },
    },
  });
  return aggregateServicesByAccount(results);
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

  const [monthlyCosts, dailyCosts, monthlyServices] = await Promise.all([
    fetchCosts(periods.monthly, 'MONTHLY'),
    fetchCosts(periods.daily, 'DAILY'),
    fetchServiceCosts(periods.monthly),
  ]);

  const blocks = buildBlocks(targets, periods, monthlyCosts, dailyCosts, monthlyServices);
  const total = sumCosts(monthlyCosts.values());
  await postToSlack(blocks, `AWS 利用料金レポート: 今月の請求見込み ${formatUsd(total.net)}`);
};
