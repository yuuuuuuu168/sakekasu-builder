import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchAuthSessionMock = vi.fn();
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: () => fetchAuthSessionMock(),
}));

const { runtimeSend, resetSommelierSession } = await import('../lib/runtimeSend');

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
const noHistory = { signal, history: [] };

describe('runtimeSend', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetSommelierSession();
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

    expect(await collect(runtimeSend('相談', noHistory))).toBe(
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

    expect(await collect(runtimeSend('相談', noHistory))).toBe('こんばんは！');
  });

  it('Authorization ヘッダーとセッション ID を付けて呼び出す', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(['data: "ok"\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    await collect(runtimeSend('相談', noHistory));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('bedrock-agentcore.ap-northeast-1.amazonaws.com');
    expect(url).toContain('qualifier=DEFAULT');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    const sessionId =
      init.headers['X-Amzn-Bedrock-AgentCore-Runtime-Session-Id'];
    // AgentCore はセッション ID に 33 文字以上を要求する
    expect(sessionId.length).toBeGreaterThanOrEqual(33);
    expect(JSON.parse(init.body)).toEqual({ prompt: '相談', history: [] });
  });

  it('直前までの会話を文脈として送る', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => sseResponse(['data: "ok"\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    await collect(
      runtimeSend('ちょっとリッチなのがいい', {
        signal,
        history: [
          { id: 'u1', role: 'user', content: 'ハイボールのおすすめある？' },
          { id: 'a1', role: 'assistant', content: 'XXX がおすすめです' },
        ],
      }),
    );

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).history).toEqual([
      { role: 'user', content: 'ハイボールのおすすめある？' },
      { role: 'assistant', content: 'XXX がおすすめです' },
    ]);
  });

  it('失敗した発言や空の発言は文脈に含めない', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => sseResponse(['data: "ok"\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    await collect(
      runtimeSend('続き', {
        signal,
        history: [
          { id: 'u1', role: 'user', content: '前の相談' },
          { id: 'a1', role: 'assistant', content: '', error: '失敗しました' },
          { id: 'a2', role: 'assistant', content: '   ' },
        ],
      }),
    );

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).history).toEqual([
      { role: 'user', content: '前の相談' },
    ]);
  });

  it('文脈は直近の件数までに絞る', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => sseResponse(['data: "ok"\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `m${i}`,
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `発言${i}`,
    }));

    await collect(runtimeSend('続き', { signal, history: many }));

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body).history;
    expect(sent).toHaveLength(10);
    expect(sent[sent.length - 1].content).toBe('発言29');
  });

  it('同じセッションでは同じセッション ID を使い、リセットで切り替わる', async () => {
    // Response の body は一度読むとロックされるため、呼び出しごとに作り直す
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => sseResponse(['data: "ok"\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    await collect(runtimeSend('1回目', noHistory));
    await collect(runtimeSend('2回目', noHistory));
    const first = fetchMock.mock.calls[0][1].headers[
      'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id'
    ];
    const second = fetchMock.mock.calls[1][1].headers[
      'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id'
    ];
    expect(second).toBe(first);

    resetSommelierSession();
    await collect(runtimeSend('3回目', noHistory));
    const third = fetchMock.mock.calls[2][1].headers[
      'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id'
    ];
    expect(third).not.toBe(first);
  });

  it('認証エラー（401/403）はログインし直す案内にする', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 403 })),
    );

    await expect(collect(runtimeSend('相談', noHistory))).rejects.toThrow(
      /ログインし直/,
    );
  });

  it('その他の HTTP エラーはステータス付きで失敗する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 500 })),
    );

    await expect(collect(runtimeSend('相談', noHistory))).rejects.toThrow(
      /HTTP 500/,
    );
  });

  it('エージェントがエラーを返した場合は例外にする', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"error": "x", "message": "An error occurred during streaming"}\n\n',
        ]),
      ),
    );

    await expect(collect(runtimeSend('相談', noHistory))).rejects.toThrow(
      /error occurred/,
    );
  });

  it('トークンが取得できない場合は呼び出さない', async () => {
    fetchAuthSessionMock.mockResolvedValue({ tokens: undefined });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(collect(runtimeSend('相談', noHistory))).rejects.toThrow(
      /認証トークン/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('parseDataLine の防御', () => {
  beforeEach(() => {
    resetSommelierSession();
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
    expect(await collect(runtimeSend('相談', noHistory))).toBe('正常な応答');
  });
});
