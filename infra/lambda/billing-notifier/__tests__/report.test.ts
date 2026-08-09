import { describe, it, expect } from 'vitest';

/**
 * レポートの集計と組み立てを検証する。
 * ハンドラは環境変数を要求するため、読み込み前に用意しておく
 */
process.env.WEBHOOK_PARAMETER_NAME = '/test/webhook';
process.env.TARGET_ACCOUNTS = JSON.stringify([
  { id: '111111111111', label: '親アカウント（管理）' },
  { id: '222222222222', label: 'sakekasu-builder（アプリ本体）' },
]);

const { resolvePeriods, aggregateByAccount, formatUsd, buildBlocks } = await import('../index.ts');

const TARGETS = [
  { id: '111111111111', label: '親アカウント（管理）' },
  { id: '222222222222', label: 'sakekasu-builder（アプリ本体）' },
];

/** Cost Explorer の応答形式でグループを作る補助 */
function resultWith(groups: [string, string, string][]) {
  return [
    {
      TimePeriod: { Start: '2026-08-01', End: '2026-08-09' },
      Groups: groups.map(([accountId, recordType, amount]) => ({
        Keys: [accountId, recordType],
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

  it('指定したアカウントがそれぞれ分かれて表示される', () => {
    const monthly = aggregateByAccount(
      resultWith([
        ['111111111111', 'Usage', '10.00'],
        ['111111111111', 'Credit', '-9.00'],
        ['222222222222', 'Usage', '5.00'],
      ]),
    );
    const daily = aggregateByAccount(resultWith([['111111111111', 'Usage', '0.50']]));

    const text = textsOf(buildBlocks(TARGETS, periods, monthly, daily));
    expect(text).toContain('親アカウント（管理）');
    expect(text).toContain('111111111111');
    expect(text).toContain('sakekasu-builder（アプリ本体）');
    expect(text).toContain('222222222222');
    // クレジット適用前・適用額・請求額の3点が出る
    expect(text).toContain('$10.00');
    expect(text).toContain('-$9.00');
    expect(text).toContain('$1.00');
  });

  it('指定外のアカウントに費用があれば「その他」として載る', () => {
    const monthly = aggregateByAccount(
      resultWith([
        ['111111111111', 'Usage', '1.00'],
        ['333333333333', 'Usage', '4.00'],
      ]),
    );
    const text = textsOf(buildBlocks(TARGETS, periods, monthly, new Map()));
    expect(text).toContain('その他のアカウント');
    expect(text).toContain('$4.00');
  });

  it('指定外のアカウントに費用が無ければ「その他」は出ない', () => {
    const monthly = aggregateByAccount(resultWith([['111111111111', 'Usage', '1.00']]));
    const text = textsOf(buildBlocks(TARGETS, periods, monthly, new Map()));
    expect(text).not.toContain('その他のアカウント');
  });

  it('組織全体の合計が出る', () => {
    const monthly = aggregateByAccount(
      resultWith([
        ['111111111111', 'Usage', '1.00'],
        ['222222222222', 'Usage', '2.00'],
        ['333333333333', 'Usage', '4.00'],
      ]),
    );
    const text = textsOf(buildBlocks(TARGETS, periods, monthly, new Map()));
    expect(text).toContain('組織全体の合計');
    expect(text).toContain('$7.00');
  });

  it('データが無いアカウントも $0.00 で表示される（欠落で落ちない）', () => {
    const blocks = buildBlocks(TARGETS, periods, new Map(), new Map());
    const text = textsOf(blocks);
    expect(text).toContain('111111111111');
    expect(text).toContain('$0.00');
  });

  it('月初日の実行では「確定」の見出しになる', () => {
    const firstDay = resolvePeriods(new Date('2026-09-01T00:05:00Z'));
    const text = textsOf(buildBlocks(TARGETS, firstDay, new Map(), new Map()));
    expect(text).toContain('8月分（確定）');
  });
});
