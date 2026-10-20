import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  clip,
  createWebhookUrlGetter,
  dropBrokenCharacters,
  escapeMrkdwn,
  postToSlack,
  safeText,
} from '../slack';

describe('dropBrokenCharacters', () => {
  it('対になっていないサロゲートだけを落とす', () => {
    expect(dropBrokenCharacters('a\ud83db🍶c\udc00')).toBe('ab🍶c');
  });
});

describe('escapeMrkdwn', () => {
  it('mrkdwn が解釈する文字を実体参照にする', () => {
    expect(escapeMrkdwn('<!channel> & <https://x|y>')).toBe(
      '&lt;!channel&gt; &amp; &lt;https://x|y&gt;',
    );
  });

  it('壊れた文字も一緒に落とす', () => {
    expect(escapeMrkdwn('a\ud83d<b')).toBe('a&lt;b');
  });
});

describe('clip', () => {
  it('上限以下ならそのまま返す', () => {
    expect(clip('abc', 3)).toBe('abc');
  });

  it('上限を超えたら省略記号を付けて詰める', () => {
    expect(clip('abcdef', 4)).toBe('abc…');
  });

  // 単純に切ると絵文字が分断され、壊れた片割れが新たに生まれる
  it('絵文字の途中では切らない', () => {
    const result = clip('ab🍶🍶', 4);
    expect(result).toBe('ab…');
    expect(dropBrokenCharacters(result)).toBe(result);
  });
});

describe('safeText', () => {
  it('無害化してから詰める', () => {
    expect(safeText('<<<<', 9)).toBe('&lt;&lt;…');
  });
});

describe('createWebhookUrlGetter', () => {
  it('一度取れた URL は使い回す', async () => {
    const load = vi.fn(async () => 'https://hooks.slack.example/a');
    const get = createWebhookUrlGetter(load, '/test/webhook');
    expect(await get()).toBe('https://hooks.slack.example/a');
    expect(await get()).toBe('https://hooks.slack.example/a');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null, ''])('値が無ければパラメータ名つきで失敗する（%s）', async (value) => {
    const get = createWebhookUrlGetter(async () => value, '/test/webhook');
    await expect(get()).rejects.toThrow('Webhook URL が未設定です: /test/webhook');
  });

  it('失敗した回は使い回さず、次に取り直す', async () => {
    const load = vi
      .fn<() => Promise<string | undefined>>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('https://hooks.slack.example/b');
    const get = createWebhookUrlGetter(load, '/test/webhook');
    await expect(get()).rejects.toThrow();
    expect(await get()).toBe('https://hooks.slack.example/b');
  });
});

describe('postToSlack', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('プレビュー文を無害化して送る', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await postToSlack('https://hooks.slack.example/a', [{ type: 'divider' }], '<!channel> 通知');

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({
      text: '&lt;!channel&gt; 通知',
      blocks: [{ type: 'divider' }],
    });
  });

  it('失敗したら状態コードだけを出し、URL は出さない', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 400 }) as Response) as typeof fetch;

    const error = await postToSlack('https://hooks.slack.example/secret', [], 'x').catch(
      (e: Error) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Slack への送信に失敗しました (HTTP 400)');
    expect((error as Error).message).not.toContain('secret');
  });
});
