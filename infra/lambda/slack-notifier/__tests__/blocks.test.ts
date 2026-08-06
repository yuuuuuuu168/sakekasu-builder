import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * Slack へ渡すブロックの組み立てを検証する。
 * ハンドラは環境変数を要求するため、読み込み前に用意しておく。
 */
process.env.WEBHOOK_PARAMETER_NAME = '/test/webhook';

// Webhook URL の取得で AWS を呼びに行かせない
vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class {
    send = async () => ({ Parameter: { Value: 'https://hooks.slack.example/test' } });
  },
  GetParameterCommand: class {
    constructor(public input: unknown) {}
  },
}));

type Block = { type: string; text?: { text?: string }; fields?: { text: string }[] };

let buildBlocksForMessage: (message: string, subject?: string | null) => Promise<Block[]>;
/** Slack へ送る本文まるごと（プレビュー文 text を含む） */
let buildPayloadForMessage: (message: string, subject?: string | null) => Promise<string>;

beforeAll(async () => {
  // ハンドラは Slack へ送ってしまうため、送信部分だけ差し替えて中身を取り出す
  const mod = await import('../index.ts');
  buildBlocksForMessage = async (message, subject = null) => {
    const captured: Block[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      captured.push(...(JSON.parse(init.body).blocks as Block[]));
      return { ok: true, status: 200 } as Response;
    }) as typeof fetch;
    try {
      await mod.handler({
        Records: [{ Sns: { Subject: subject, Message: message, Timestamp: '2026-08-06T00:00:00Z' } }],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    return captured;
  };

  buildPayloadForMessage = async (message, subject = null) => {
    let payload = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      payload = init.body;
      return { ok: true, status: 200 } as Response;
    }) as typeof fetch;
    try {
      await mod.handler({
        Records: [{ Sns: { Subject: subject, Message: message, Timestamp: '2026-08-06T00:00:00Z' } }],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    return payload;
  };
});

/** ブロック全体を1つの文字列にして中身を調べる */
function flatten(blocks: Block[]): string {
  return JSON.stringify(blocks);
}

function healthMessage(detail: Record<string, unknown>): string {
  return JSON.stringify({ source: 'aws.health', region: 'ap-northeast-1', detail });
}

describe('Slack へ渡す文字列の無害化', () => {
  // mrkdwn は <URL|文字> をリンクとして解釈するため、そのまま流すと
  // 偽のリンクを通知に差し込まれる
  it('本文のリンク記法を無効にする', async () => {
    const blocks = await buildBlocksForMessage(
      healthMessage({
        service: 'IAM',
        eventTypeCategory: 'issue',
        eventDescription: [{ latestDescription: '<https://example.com|ここをクリック>' }],
      }),
    );
    const text = flatten(blocks);
    expect(text).not.toContain('<https://example.com|');
    expect(text).toContain('&lt;https://example.com');
  });

  it('一斉メンションを無効にする', async () => {
    const blocks = await buildBlocksForMessage(
      healthMessage({
        service: 'EC2',
        eventTypeCategory: 'issue',
        eventDescription: [{ latestDescription: '<!channel> 緊急です' }],
      }),
    );
    expect(flatten(blocks)).not.toContain('<!channel>');
  });

  it('影響リソースの値も無害化する', async () => {
    const blocks = await buildBlocksForMessage(
      healthMessage({
        service: 'S3',
        eventTypeCategory: 'issue',
        affectedEntities: [{ entityValue: '<https://evil.example|bucket>' }],
      }),
    );
    expect(flatten(blocks)).not.toContain('<https://evil.example|');
  });

  it('アラーム以外の任意メッセージも無害化する', async () => {
    const blocks = await buildBlocksForMessage('<!here> <https://evil.example|クリック>');
    const text = flatten(blocks);
    expect(text).not.toContain('<!here>');
    expect(text).not.toContain('<https://evil.example|');
  });

  // CloudWatch アラームの説明文にも同じ処理を通す
  it('アラームの説明も無害化する', async () => {
    const blocks = await buildBlocksForMessage(
      JSON.stringify({
        AlarmName: 'test-alarm',
        NewStateValue: 'ALARM',
        AlarmDescription: '<https://evil.example|対処はこちら>',
      }),
    );
    expect(flatten(blocks)).not.toContain('<https://evil.example|');
  });
});

describe('Slack の文字数上限', () => {
  // 上限を超えると送信そのものが 400 で失敗し、通知が届かなくなる
  const SECTION_LIMIT = 3000;

  it('長い本文でも section の上限を超えない', async () => {
    const blocks = await buildBlocksForMessage(
      healthMessage({
        service: 'RDS',
        eventTypeCategory: 'issue',
        eventDescription: [{ latestDescription: 'あ'.repeat(50_000) }],
      }),
    );
    for (const block of blocks) {
      if (block.text?.text) {
        expect(block.text.text.length).toBeLessThan(SECTION_LIMIT);
      }
    }
  });

  // ARN は1件で最大2048文字あり、数件並ぶだけで上限を超える
  it('長い ARN が並んでも上限を超えず、省略件数を添える', async () => {
    const longArn = (n: number) => `arn:aws:rds:ap-northeast-1:111122223333:db:${'x'.repeat(900)}${n}`;
    const blocks = await buildBlocksForMessage(
      healthMessage({
        service: 'RDS',
        eventTypeCategory: 'issue',
        affectedEntities: [1, 2, 3, 4, 5].map((n) => ({ entityValue: longArn(n) })),
      }),
    );

    const resourceBlock = blocks.find((b) => b.text?.text?.includes('影響を受けるリソース'));
    expect(resourceBlock).toBeDefined();
    expect(resourceBlock!.text!.text!.length).toBeLessThan(SECTION_LIMIT);
    expect(resourceBlock!.text!.text).toContain('ほか');
  });
});

// Slack は最上位の text をプレビューやプッシュ通知で mrkdwn として扱う。
// ブロック側だけ無害化しても、ここが素通しだと同じことが起きる
describe('通知プレビュー文（text フィールド）', () => {
  const evil = '<!channel> <https://evil.example|いますぐ確認>';

  it.each([
    ['アラーム名', JSON.stringify({ AlarmName: evil, NewStateValue: 'ALARM' })],
    ['アラームの状態', JSON.stringify({ AlarmName: 'ok', NewStateValue: evil })],
    ['Health のサービス名', JSON.stringify({ source: 'aws.health', detail: { service: evil, eventTypeCategory: 'issue' } })],
    ['Health の種類', JSON.stringify({ source: 'aws.health', detail: { service: 'S3', eventTypeCategory: evil } })],
    ['JSON でない本文', 'これは JSON ではない'],
  ])('%s から記法が漏れない', async (_label, message) => {
    const payload = await buildPayloadForMessage(message, evil);
    const text = JSON.parse(payload).text as string;
    expect(text).not.toContain('<!channel>');
    expect(text).not.toContain('<https://evil.example|');
  });

  it('件名（Subject）からも漏れない', async () => {
    const payload = await buildPayloadForMessage('ただの本文', evil);
    const text = JSON.parse(payload).text as string;
    expect(text).not.toContain('<!channel>');
    expect(text).not.toContain('<https://evil.example|');
  });
});

// 個別の組み立て箇所を1つ通し忘れても、送信の直前で必ず無害化される。
// 「うっかり漏らしても守られる」ことをここで担保する
describe('送信直前の砦', () => {
  it('プレビュー文は必ず無害化されてから送られる', async () => {
    const mod = await import('../index.ts');
    let payload = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      payload = init.body;
      return { ok: true, status: 200 } as Response;
    }) as typeof fetch;
    try {
      // 組み立て側を経由せず、生の文字列を直接渡す経路を模す
      await mod.handler({
        Records: [
          {
            Sns: {
              Subject: null,
              Message: JSON.stringify({
                AlarmName: 'x',
                NewStateValue: 'ALARM',
                // ここは組み立て時に safeText を通していない値として扱われる
                OldStateValue: '<!here>',
              }),
              Timestamp: '2026-08-06T00:00:00Z',
            },
          },
        ],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    const sent = JSON.parse(payload);
    // text（プレビュー）にも blocks にも記法が残らない
    expect(JSON.stringify(sent)).not.toContain('<!here>');
  });

  it('プレビュー文の長さも抑える', async () => {
    const payload = await buildPayloadForMessage(
      JSON.stringify({ AlarmName: 'あ'.repeat(5000), NewStateValue: 'ALARM' }),
    );
    const text = JSON.parse(payload).text as string;
    expect(text.length).toBeLessThanOrEqual(210);
  });
});

// 無害化を二度通すと &lt; が &amp;lt; になり、通知の文字が壊れる。
// 見出し（plain_text）は記法を解釈しないので、そもそも通してはいけない
describe('無害化のかけすぎで表示を壊さない', () => {
  it('プレビュー文に実体参照が二重に出ない', async () => {
    const payload = await buildPayloadForMessage(
      JSON.stringify({ AlarmName: 'cpu>90%', NewStateValue: 'ALARM' }),
    );
    const text = JSON.parse(payload).text as string;
    expect(text).toContain('cpu&gt;90%');
    expect(text).not.toContain('&amp;gt;');
  });

  it('見出しにはエスケープせず、そのままの文字を出す', async () => {
    const blocks = await buildBlocksForMessage(
      JSON.stringify({ AlarmName: 'prod<->staging', NewStateValue: 'ALARM' }),
    );
    const header = blocks.find((b) => b.type === 'header');
    // plain_text は実体参照を戻さないので、素の文字でなければ画面が壊れる
    expect(header!.text!.text).toContain('prod<->staging');
    expect(header!.text!.text).not.toContain('&lt;');
  });

  it('Health の見出しもそのままの文字を出す', async () => {
    const blocks = await buildBlocksForMessage(
      healthMessage({ service: 'S3<>test', eventTypeCategory: 'issue' }),
    );
    const header = blocks.find((b) => b.type === 'header');
    expect(header!.text!.text).toContain('S3<>test');
    expect(header!.text!.text).not.toContain('&lt;');
  });

  it('mrkdwn 側は一度だけ無害化される', async () => {
    const blocks = await buildBlocksForMessage(
      healthMessage({
        service: 'S3',
        eventTypeCategory: 'issue',
        eventDescription: [{ latestDescription: 'a & b <tag>' }],
      }),
    );
    const text = JSON.stringify(blocks);
    expect(text).toContain('a &amp; b &lt;tag&gt;');
    expect(text).not.toContain('&amp;amp;');
    expect(text).not.toContain('&amp;lt;');
  });
});
