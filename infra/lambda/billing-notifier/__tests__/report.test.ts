import { describe, it, expect } from 'vitest';

/**
 * レポートの集計と組み立てを検証する。
 * ハンドラは環境変数を要求するため、読み込み前に用意しておく
 */
process.env.WEBHOOK_PARAMETER_NAME = '/test/webhook';
process.env.TARGET_ACCOUNTS = JSON.stringify([
  { id: '222222222222', label: 'sakekasu-builder（アプリ本体）' },
]);

const {
  resolvePeriods,
  aggregateByAccount,
  aggregateServicesByAccount,
  sumServicesAcrossAccounts,
  formatUsd,
  buildBlocks,
} = await import('../index.ts');

const TARGETS = [{ id: '222222222222', label: 'sakekasu-builder（アプリ本体）' }];

/** Cost Explorer の応答形式でグループを作る補助（Keys は任意の2次元） */
function resultWith(groups: [string, string, string][]) {
  return [
    {
      TimePeriod: { Start: '2026-08-01', End: '2026-08-09' },
      Groups: groups.map(([key1, key2, amount]) => ({
        Keys: [key1, key2],
        Metrics: { UnblendedCost: { Amount: amount, Unit: 'USD' } },
      })),
    },
  ];
}

describe('resolvePeriods', () => {
  it('月の途中は「月初〜今日」と「昨日1日」を返す', () => {
    const periods = resolvePeriods(new Date('2026-08-09T00:05:00Z'));
    expect(periods.monthly).toEqual({ start: '2026-08-01', end: '2026-08-09' });
    expect(periods.daily).toEqual({ start: '2026-08-08', end: '2026-08-09' });
    expect(periods.isPreviousMonth).toBe(false);
  });

  it('月初日は前月まるごとを返す（今月累計が空になるため）', () => {
    const periods = resolvePeriods(new Date('2026-09-01T00:05:00Z'));
    expect(periods.monthly).toEqual({ start: '2026-08-01', end: '2026-09-01' });
    expect(periods.daily).toEqual({ start: '2026-08-31', end: '2026-09-01' });
    expect(periods.isPreviousMonth).toBe(true);
  });

  it('年初日は前年12月を返す（年またぎでも壊れない）', () => {
    const periods = resolvePeriods(new Date('2027-01-01T00:05:00Z'));
    expect(periods.monthly).toEqual({ start: '2026-12-01', end: '2027-01-01' });
    expect(periods.daily).toEqual({ start: '2026-12-31', end: '2027-01-01' });
  });
});

describe('aggregateByAccount', () => {
  it('Credit だけを分離し、他はクレジット適用前の利用額に足す', () => {
    const costs = aggregateByAccount(
      resultWith([
        ['111111111111', 'Usage', '10.00'],
        ['111111111111', 'Tax', '1.00'],
        ['111111111111', 'Credit', '-8.50'],
      ]),
    );
    expect(costs.get('111111111111')).toEqual({ gross: 11, credit: -8.5, net: 2.5 });
  });

  it('複数アカウント・複数期間をまたいで合算する', () => {
    const results = [
      ...resultWith([['111111111111', 'Usage', '1.00']]),
      ...resultWith([
        ['111111111111', 'Usage', '2.00'],
        ['222222222222', 'Usage', '5.00'],
      ]),
    ];
    const costs = aggregateByAccount(results);
    expect(costs.get('111111111111')?.gross).toBeCloseTo(3);
    expect(costs.get('222222222222')?.gross).toBeCloseTo(5);
  });

  it('数値でない金額や欠けたキーは無視する', () => {
    const costs = aggregateByAccount([
      {
        TimePeriod: { Start: '2026-08-01', End: '2026-08-02' },
        Groups: [
          { Keys: [], Metrics: { UnblendedCost: { Amount: '1.00', Unit: 'USD' } } },
          { Keys: ['111111111111', 'Usage'], Metrics: { UnblendedCost: { Amount: 'abc', Unit: 'USD' } } },
        ],
      },
    ]);
    expect(costs.size).toBe(0);
  });
});

describe('aggregateServicesByAccount', () => {
  it('アカウントごとにサービス別の金額を集計する', () => {
    const costs = aggregateServicesByAccount(
      resultWith([
        ['111111111111', 'Amazon Bedrock', '3.00'],
        ['111111111111', 'AWS Lambda', '1.00'],
        ['222222222222', 'Amazon Bedrock', '2.00'],
      ]),
    );
    expect(costs.get('111111111111')?.get('Amazon Bedrock')).toBeCloseTo(3);
    expect(costs.get('111111111111')?.get('AWS Lambda')).toBeCloseTo(1);
    expect(costs.get('222222222222')?.get('Amazon Bedrock')).toBeCloseTo(2);
  });

  it('全アカウントの合算で組織全体のサービス内訳が出る', () => {
    const costs = aggregateServicesByAccount(
      resultWith([
        ['111111111111', 'Amazon Bedrock', '3.00'],
        ['222222222222', 'Amazon Bedrock', '2.00'],
        ['222222222222', 'Amazon S3', '0.50'],
      ]),
    );
    const total = sumServicesAcrossAccounts(costs);
    expect(total.get('Amazon Bedrock')).toBeCloseTo(5);
    expect(total.get('Amazon S3')).toBeCloseTo(0.5);
  });
});

describe('formatUsd', () => {
  it('2桁固定のドル表記にする', () => {
    expect(formatUsd(12.345)).toBe('$12.35');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(-8.5)).toBe('-$8.50');
  });

  it('丸め誤差で -$0.00 にならない', () => {
    expect(formatUsd(-0.0001)).toBe('$0.00');
  });
});

describe('buildBlocks', () => {
  const periods = resolvePeriods(new Date('2026-08-09T00:05:00Z'));

  function textsOf(blocks: unknown[]): string {
    return JSON.stringify(blocks);
  }

  const monthly = aggregateByAccount(
    resultWith([
      ['111111111111', 'Usage', '10.00'],
      ['111111111111', 'Credit', '-9.00'],
      ['222222222222', 'Usage', '5.00'],
    ]),
  );
  const services = aggregateServicesByAccount(
    resultWith([
      ['111111111111', 'AWS CloudWatch', '10.00'],
      ['222222222222', 'Amazon Bedrock', '3.00'],
      ['222222222222', 'AWS Lambda', '2.00'],
    ]),
  );

  it('組織全体の合計が先頭で、続けて指定アカウントが載る', () => {
    const text = textsOf(buildBlocks(TARGETS, periods, monthly, new Map(), services));
    const totalIndex = text.indexOf('組織全体の合計');
    const accountIndex = text.indexOf('sakekasu-builder（アプリ本体）');
    expect(totalIndex).toBeGreaterThan(-1);
    expect(accountIndex).toBeGreaterThan(totalIndex);
    // 合計は全アカウント分（10 + 5 = 15、クレジット -9、請求 6）
    expect(text).toContain('$15.00');
    expect(text).toContain('-$9.00');
    expect(text).toContain('$6.00');
  });

  it('親アカウント・その他アカウントのセクションは出ない', () => {
    const text = textsOf(buildBlocks(TARGETS, periods, monthly, new Map(), services));
    expect(text).not.toContain('親アカウント');
    expect(text).not.toContain('その他のアカウント');
    expect(text).not.toContain('111111111111');
  });

  it('組織全体と指定アカウントの両方にサービス別内訳が載る', () => {
    const text = textsOf(buildBlocks(TARGETS, periods, monthly, new Map(), services));
    expect(text).toContain('サービス別内訳');
    // 組織全体: 全アカウント合算で CloudWatch が1位
    expect(text).toContain('1. AWS CloudWatch: $10.00');
    // sakekasu-builder: 自分の分だけで Bedrock が1位
    expect(text).toContain('1. Amazon Bedrock: $3.00');
    expect(text).toContain('2. AWS Lambda: $2.00');
  });

  it('上位5位までを実サービス名で並べ、6位以下は「その他」に畳む', () => {
    const many = aggregateServicesByAccount(
      resultWith(
        Array.from({ length: 7 }, (_, i): [string, string, string] => [
          '222222222222',
          `Service ${String.fromCharCode(65 + i)}`,
          `${7 - i}.00`,
        ]),
      ),
    );
    const text = textsOf(buildBlocks(TARGETS, periods, monthly, new Map(), many));
    // 5件目までは実サービス名で載る
    expect(text).toContain('5. Service E: $3.00');
    // 6件目以降（$2 + $1）だけが「その他」になる
    expect(text).not.toContain('Service F');
    expect(text).toContain('その他: $3.00');
  });

  it('表示上 $0.00 になる端数のサービスは実名では載せない', () => {
    const withDust = aggregateServicesByAccount(
      resultWith([
        ['222222222222', 'Amazon Bedrock', '3.00'],
        ['222222222222', 'Amazon SNS', '0.003'],
        ['222222222222', 'Amazon SQS', '0.004'],
      ]),
    );
    const text = textsOf(buildBlocks(TARGETS, periods, monthly, new Map(), withDust));
    expect(text).toContain('1. Amazon Bedrock: $3.00');
    expect(text).not.toContain('Amazon SNS');
    // 端数の集まり（$0.007）は四捨五入で $0.01 になるので「その他」に載る
    expect(text).toContain('その他: $0.01');
  });

  it('サービス名の mrkdwn 特殊文字は無害化される', () => {
    const withAmp = aggregateServicesByAccount(
      resultWith([['222222222222', 'AWS Cost & Usage Report', '1.00']]),
    );
    const text = textsOf(buildBlocks(TARGETS, periods, monthly, new Map(), withAmp));
    expect(text).toContain('AWS Cost &amp; Usage Report');
  });

  it('データが無くても $0.00 と「利用なし」表示で落ちない', () => {
    const text = textsOf(buildBlocks(TARGETS, periods, new Map(), new Map(), new Map()));
    expect(text).toContain('222222222222');
    expect(text).toContain('$0.00');
    expect(text).toContain('今月の利用はまだありません');
  });

  it('月初日の実行では「確定」の見出しになる', () => {
    const firstDay = resolvePeriods(new Date('2026-09-01T00:05:00Z'));
    const text = textsOf(buildBlocks(TARGETS, firstDay, new Map(), new Map(), new Map()));
    expect(text).toContain('8月分（確定）');
  });
});
