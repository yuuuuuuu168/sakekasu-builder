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

/**
 * サロゲートペアの片割れ（壊れた文字）が残っていないか。
 *
 * JSON 文字列にすると壊れた文字は "\\ud83d" という ASCII 列に変わり、
 * そのままでは見つけられない。実際の文字列に対して調べること
 */
function hasLoneSurrogate(text: string): boolean {
  return [...text].some((ch) => {
    const code = ch.charCodeAt(0);
    return code >= 0xd800 && code <= 0xdfff && ch.length === 1;
  });
}

/** ブロックや送信本文に含まれる文字列をすべて集める */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => collectStrings(v, out));
  }
  return out;
}

/** 実際の文字列に戻したうえで壊れがないか調べる */
function anyLoneSurrogate(value: unknown): boolean {
  return collectStrings(value).some(hasLoneSurrogate);
}

// 絵文字は2つ分の長さを持つため、単純に切ると途中で分断される。
// 壊れた片割れは JSON として不正で、Slack 側に拒否されうる
describe('長い文字を切るときに絵文字を壊さない', () => {
  it('アラーム名の途中に絵文字があっても壊れない', async () => {
    const payload = await buildPayloadForMessage(
      JSON.stringify({
        // clip(name, 200) は 199 文字目で切る。絵文字を 198 から置くと
        // ちょうど分断される（この値でないと壊れないことを確認済み）
        AlarmName: 'a'.repeat(198) + '🔥' + 'b'.repeat(50),
        NewStateValue: 'ALARM',
      }),
    );
    expect(anyLoneSurrogate(JSON.parse(payload))).toBe(false);
  });

  it('Health のサービス名が絵文字だらけでも壊れない', async () => {
    const blocks = await buildBlocksForMessage(
      healthMessage({ service: '🔥'.repeat(200), eventTypeCategory: 'issue' }),
    );
    expect(anyLoneSurrogate(blocks)).toBe(false);
  });

  it('本文が絵文字だらけでも壊れない', async () => {
    const blocks = await buildBlocksForMessage(
      healthMessage({
        service: 'S3',
        eventTypeCategory: 'issue',
        eventDescription: [{ latestDescription: '🍶'.repeat(3000) }],
      }),
    );
    expect(anyLoneSurrogate(blocks)).toBe(false);
  });

  // エスケープで文字数が増え、切る位置がずれて絵文字に当たる場合
  it('エスケープで長さが変わっても壊れない', async () => {
    const payload = await buildPayloadForMessage(
      JSON.stringify({
        // '<' は escapeMrkdwn で 4 文字（&lt;）になる。
        // 50 + 37*4 = 198 文字ぶんとなり、直後の絵文字が切り出し位置に重なる
        AlarmName: 'a'.repeat(50) + '<'.repeat(37) + '🔥' + 'b'.repeat(50),
        NewStateValue: 'ALARM',
      }),
    );
    expect(anyLoneSurrogate(JSON.parse(payload))).toBe(false);
  });

  it('切る必要がなければそのまま出す', async () => {
    const blocks = await buildBlocksForMessage(
      healthMessage({ service: '🔥S3', eventTypeCategory: 'issue' }),
    );
    const header = blocks.find((b) => b.type === 'header');
    expect(header!.text!.text).toContain('🔥S3');
  });

  // 本文は 1500 で切るため、そこに絵文字を重ねる
  it('本文の切り出し位置に絵文字が来ても壊れない', async () => {
    const blocks = await buildBlocksForMessage(
      healthMessage({
        service: 'S3',
        eventTypeCategory: 'issue',
        eventDescription: [{ latestDescription: 'a'.repeat(1498) + '🔥' + 'b'.repeat(50) }],
      }),
    );
    expect(anyLoneSurrogate(blocks)).toBe(false);
  });
});

// Slack の header は 150 文字まで。超えると送信ごと 400 で失敗し、
// 通知が届かなくなる（実際に踏んだ）
describe('見出しの長さ制限', () => {
  const HEADER_LIMIT = 150;

  it.each([
    ['アラーム', JSON.stringify({ AlarmName: 'あ'.repeat(500), NewStateValue: 'ALARM' })],
    ['Health', JSON.stringify({ source: 'aws.health', detail: { service: 'S'.repeat(500), eventTypeCategory: 'issue' } })],
    ['JSON でない本文', 'ただの本文'],
  ])('%s の見出しが上限を超えない', async (_label, message) => {
    const blocks = await buildBlocksForMessage(message, 'x'.repeat(500));
    const header = blocks.find((b) => b.type === 'header');
    expect(header).toBeDefined();
    expect(header!.text!.text!.length).toBeLessThanOrEqual(HEADER_LIMIT);
  });
});
