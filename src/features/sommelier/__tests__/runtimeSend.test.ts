import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchAuthSessionMock = vi.fn();
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: () => fetchAuthSessionMock(),
}));

const { runtimeSend } = await import('../lib/runtimeSend');
const { isAbortError } = await import('../lib/errors');

/** SSE 形式のレスポンスを組み立てる（実際の Runtime と同じ形） */
function sseResponse(lines: string[], init: ResponseInit = {}) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, ...init });
}

async function collect(iterable: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const chunk of iterable) out += chunk;
  return out;
}

const signal = new AbortController().signal;
/** 33文字以上という AgentCore の要求を満たす、テスト用の固定セッション ID */
const SESSION_ID = 'session-0123456789-0123456789-0123456789';
const options = { signal, sessionId: SESSION_ID };

describe('runtimeSend', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchAuthSessionMock.mockResolvedValue({
      tokens: { accessToken: { toString: () => 'test-token' } },
    });
  });

  it('SSE のチャンクを連結して返す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sseResponse(['data: "日本酒"\n\n', 'data: "がおすすめ"\n\n']),
      ),
    );

    expect(await collect(runtimeSend('相談', options))).toBe(
      '日本酒がおすすめ',
    );
  });

  it('チャンクが行の途中で分割されても復元できる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        // 1つの data 行が2回の受信に分かれるケース
        sseResponse(['data: "こんば', 'んは"\n\n', 'data: "！"\n\n']),
      ),
    );

    expect(await collect(runtimeSend('相談', options))).toBe('こんばんは！');
  });

  it('Authorization ヘッダーとセッション ID を付けて呼び出す', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(['data: "ok"\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    await collect(runtimeSend('相談', options));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('bedrock-agentcore.ap-northeast-1.amazonaws.com');
    expect(url).toContain('qualifier=DEFAULT');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    // どの会話の続きかは、渡されたセッション ID がそのまま伝える
    expect(
      init.headers['X-Amzn-Bedrock-AgentCore-Runtime-Session-Id'],
    ).toBe(SESSION_ID);
    expect(JSON.parse(init.body)).toEqual({ prompt: '相談' });
  });

  it('会話履歴は送らない（エージェントが自分の記憶から引くため）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(['data: "ok"\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    await collect(runtimeSend('続き', options));

    // 履歴を自己申告できると、細工した偽のアシスタント発言を送り込めてしまう
    expect('history' in JSON.parse(fetchMock.mock.calls[0][1].body)).toBe(false);
  });

  it('添付画像を必要なキーだけに絞ってペイロードに含める', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(['data: "ok"\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    await collect(
      runtimeSend('この中でおすすめある？', {
        signal,
        sessionId: SESSION_ID,
        images: [
          // プレビュー用 dataURL のような余計なキーは送らないこと
          {
            format: 'jpeg',
            data: 'aGVsbG8=',
            dataUrl: 'data:image/jpeg;base64,aGVsbG8=',
          } as unknown as { format: 'jpeg'; data: string },
        ],
      }),
    );

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      prompt: 'この中でおすすめある？',
      images: [{ format: 'jpeg', data: 'aGVsbG8=' }],
    });
  });

  it('画像がないときは images キー自体を送らない', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(['data: "ok"\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    await collect(
      runtimeSend('相談', { signal, sessionId: SESSION_ID, images: [] }),
    );

    expect('images' in JSON.parse(fetchMock.mock.calls[0][1].body)).toBe(false);
  });

  it('セッション ID が変われば別の会話として送る', async () => {
    // Response の body は一度読むとロックされるため、呼び出しごとに作り直す
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => sseResponse(['data: "ok"\n\n']));
    vi.stubGlobal('fetch', fetchMock);
    const newSessionId = 'session-9876543210-9876543210-9876543210';

    await collect(runtimeSend('1回目', options));
    await collect(runtimeSend('2回目', { signal, sessionId: newSessionId }));

    const header = 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id';
    expect(fetchMock.mock.calls[0][1].headers[header]).toBe(SESSION_ID);
    expect(fetchMock.mock.calls[1][1].headers[header]).toBe(newSessionId);
  });

  it('認証エラー（401/403）は auth として区別する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 403 })),
    );

    await expect(collect(runtimeSend('相談', options))).rejects.toMatchObject({
      kind: 'auth',
      status: 403,
    });
  });

  it('その他の HTTP エラーは server としてステータス付きで失敗する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 500 })),
    );

    await expect(collect(runtimeSend('相談', options))).rejects.toMatchObject({
      kind: 'server',
      status: 500,
    });
  });

  it('通信自体に失敗した場合は network として区別する', async () => {
    // fetch は接続できないと TypeError を投げる
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(collect(runtimeSend('相談', options))).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('中断はそのまま伝える（失敗として扱わない）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('中断されました', 'AbortError')),
    );

    await expect(collect(runtimeSend('相談', options))).rejects.toSatisfy(
      (err: unknown) => isAbortError(err),
    );
  });

  it('エージェントがエラーを返した場合は server として例外にする', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"error": "x", "message": "An error occurred during streaming"}\n\n',
        ]),
      ),
    );

    await expect(collect(runtimeSend('相談', options))).rejects.toMatchObject({
      kind: 'server',
    });
  });

  it('トークンが取得できない場合は呼び出さず auth にする', async () => {
    fetchAuthSessionMock.mockResolvedValue({ tokens: undefined });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(collect(runtimeSend('相談', options))).rejects.toMatchObject({
      kind: 'auth',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('トークンの更新に失敗した場合も auth にする', async () => {
    fetchAuthSessionMock.mockRejectedValue(new Error('NotAuthorizedException'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(collect(runtimeSend('相談', options))).rejects.toMatchObject({
      kind: 'auth',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('parseDataLine の防御', () => {
  beforeEach(() => {
    fetchAuthSessionMock.mockResolvedValue({
      tokens: { accessToken: { toString: () => 'test-token' } },
    });
  });

  it('JSON でない行は表示せず捨てる（内部情報を出さない）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () =>
        sseResponse([
          'data: <html>internal error page</html>\n\n',
          'data: "正常な応答"\n\n',
        ]),
      ),
    );

    // 生のペイロードが本文に混ざらないこと
    expect(await collect(runtimeSend('相談', options))).toBe('正常な応答');
  });
});
