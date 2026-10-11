/**
 * Claude の呼び先の切り替えと、Bedrock へのフォールバックのテスト。
 *
 * 守りたいのは 3 つ。
 * - ID 連携の値が揃うまでは Bedrock だけで動く（Console の設定前でも機能を止めない）
 * - クレジット切れ・認証・障害では Bedrock でやり直し、ログに fallback=true を残す
 * - こちらの頼み方の誤り（400）は Bedrock に回さず、そのまま失敗にする
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { APIConnectionTimeoutError, APIError } from '@anthropic-ai/sdk/core/error';

const { mockCreate, mockBedrockSend, anthropicOptions } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockBedrockSend: vi.fn(),
  anthropicOptions: [] as Record<string, unknown>[],
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
    constructor(options: Record<string, unknown>) {
      anthropicOptions.push(options);
    }
  },
}));

vi.mock('@anthropic-ai/sdk/lib/credentials/oidc-federation', () => ({
  oidcFederationProvider: (config: Record<string, unknown>) => ({ federation: config }),
}));

vi.mock('@aws-sdk/client-sts', () => ({
  STSClient: class {
    send = vi.fn();
  },
  GetWebIdentityTokenCommand: class {},
}));

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: class {
    send = mockBedrockSend;
  },
  InvokeModelCommand: class {
    constructor(input: Record<string, unknown>) {
      Object.assign(this, input);
    }
  },
}));

import {
  buildAnthropicRequest,
  buildBedrockRequest,
  canForceToolChoice,
  createLlmClient,
  fallbackReason,
  readLlmConfig,
  RefusalError,
  type ToolRequest,
} from '../llm.js';

const FEDERATION_ENV = {
  ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_test',
  ANTHROPIC_ORGANIZATION_ID: '00000000-0000-0000-0000-000000000000',
  ANTHROPIC_SERVICE_ACCOUNT_ID: 'svac_test',
};

const BEDROCK_MODEL = 'jp.anthropic.claude-haiku-4-5-20251001-v1:0';

const REQUEST: ToolRequest = {
  maxTokens: 1024,
  tool: {
    name: 'record_test',
    description: '結果を記録する',
    input_schema: { type: 'object', properties: {} },
  },
  messages: [{ role: 'user', content: 'こんにちは' }],
};

function anthropicMessage(overrides: Record<string, unknown> = {}) {
  return {
    content: [{ type: 'tool_use', name: 'record_test', input: { ok: true } }],
    stop_reason: 'tool_use',
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 80,
      cache_creation_input_tokens: 0,
    },
    ...overrides,
  };
}

function bedrockResponse() {
  return {
    body: new TextEncoder().encode(
      JSON.stringify({
        content: [{ type: 'tool_use', name: 'record_test', input: { from: 'bedrock' } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    ),
  };
}

function apiError(status: number, message: string) {
  return APIError.generate(status, { error: { message } }, message, new Headers());
}

describe('readLlmConfig', () => {
  it('BEDROCK_MODEL_ID が無ければ例外にする（控えのモデルの既定値を持たない）', () => {
    expect(() => readLlmConfig('ANTHROPIC_MODEL_OCR', 'claude-haiku-5-5', {})).toThrow(
      'BEDROCK_MODEL_ID is not set',
    );
    expect(() =>
      readLlmConfig('ANTHROPIC_MODEL_OCR', 'claude-haiku-5-5', { BEDROCK_MODEL_ID: '' }),
    ).toThrow('BEDROCK_MODEL_ID is not set');
  });

  it('ID 連携の値が揃っていれば Claude API を使う', () => {
    const config = readLlmConfig('ANTHROPIC_MODEL_OCR', 'claude-haiku-5-5', {
      BEDROCK_MODEL_ID: BEDROCK_MODEL,
      ...FEDERATION_ENV,
    });
    expect(config.provider).toBe('anthropic');
    expect(config.anthropicModel).toBe('claude-haiku-5-5');
    expect(config.federation).toEqual({
      ruleId: 'fdrl_test',
      organizationId: FEDERATION_ENV.ANTHROPIC_ORGANIZATION_ID,
      serviceAccountId: 'svac_test',
    });
  });

  it('ID 連携の値が欠けていれば Bedrock だけで動く', () => {
    const config = readLlmConfig('ANTHROPIC_MODEL_OCR', 'claude-haiku-5-5', {
      BEDROCK_MODEL_ID: BEDROCK_MODEL,
      ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_test',
    });
    expect(config.provider).toBe('bedrock');
    expect(config.federation).toBeUndefined();
  });

  it('LLM_PROVIDER=bedrock なら ID 連携があっても Bedrock を使う', () => {
    const config = readLlmConfig('ANTHROPIC_MODEL_OCR', 'claude-haiku-5-5', {
      BEDROCK_MODEL_ID: BEDROCK_MODEL,
      LLM_PROVIDER: 'bedrock',
      ...FEDERATION_ENV,
    });
    expect(config.provider).toBe('bedrock');
  });

  it('モデルとワークスペースは環境変数で変えられる', () => {
    const config = readLlmConfig('ANTHROPIC_MODEL_OCR', 'claude-haiku-5-5', {
      BEDROCK_MODEL_ID: BEDROCK_MODEL,
      ANTHROPIC_MODEL_OCR: 'claude-sonnet-5-5',
      ANTHROPIC_WORKSPACE_ID: 'wrkspc_test',
      ...FEDERATION_ENV,
    });
    expect(config.anthropicModel).toBe('claude-sonnet-5-5');
    expect(config.federation?.workspaceId).toBe('wrkspc_test');
  });
});

describe('fallbackReason', () => {
  it.each([
    [apiError(400, 'Your credit balance is too low to access the Anthropic API.'), 'credit_balance'],
    [apiError(402, 'billing problem'), 'billing'],
    [apiError(401, 'invalid token'), 'authentication'],
    [apiError(403, 'forbidden'), 'permission'],
    [apiError(429, 'rate limited'), 'rate_limit'],
    [apiError(529, 'overloaded'), 'overloaded'],
    [apiError(500, 'internal'), 'server_error'],
    [new APIConnectionTimeoutError(), 'timeout'],
    [new RefusalError('断りました'), 'refusal'],
    [new Error('STS が ID トークンを返しませんでした'), 'credentials'],
  ])('%s は Bedrock でやり直す（%s）', (error, expected) => {
    expect(fallbackReason(error)).toBe(expected);
  });

  it('残高不足以外の 400 はやり直さない（頼み方の誤りが見えなくなる）', () => {
    expect(fallbackReason(apiError(400, 'tools.0: invalid schema'))).toBeUndefined();
    expect(fallbackReason(apiError(404, 'model not found'))).toBeUndefined();
  });
});

describe('頼み方の組み立て', () => {
  it('Claude API には temperature を渡さず、tool の定義をキャッシュする', () => {
    const body = buildAnthropicRequest('claude-haiku-5-5', REQUEST);
    expect(body).not.toHaveProperty('temperature');
    expect(body.tools?.[0]).toMatchObject({
      name: 'record_test',
      cache_control: { type: 'ephemeral' },
    });
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'record_test' });
    expect(body.output_config).toEqual({ effort: 'low' });
  });

  it('tool を強制できないモデルでは auto にする（強制すると 400 になる）', () => {
    expect(canForceToolChoice('claude-haiku-5-5')).toBe(true);
    expect(canForceToolChoice('claude-sonnet-5-5')).toBe(false);
    expect(buildAnthropicRequest('claude-sonnet-5-5', REQUEST).tool_choice).toEqual({
      type: 'auto',
    });
  });

  it('Bedrock には切り替え前と同じ形で頼む', () => {
    const body = buildBedrockRequest(REQUEST);
    expect(body).toMatchObject({
      anthropic_version: 'bedrock-2023-05-31',
      temperature: 0,
      tool_choice: { type: 'tool', name: 'record_test' },
    });
    // Bedrock の旧モデルにはキャッシュの印を送らない（最小長に届かず効かないうえ、形が変わる）
    expect((body.tools as Record<string, unknown>[])[0]).not.toHaveProperty('cache_control');
  });
});

describe('createLlmClient', () => {
  const originalEnv = { ...process.env };
  let warn: ReturnType<typeof vi.spyOn>;
  let info: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    anthropicOptions.length = 0;
    process.env = { ...originalEnv, BEDROCK_MODEL_ID: BEDROCK_MODEL, ...FEDERATION_ENV };
    delete process.env.LLM_PROVIDER;
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    warn.mockRestore();
    info.mockRestore();
  });

  function client() {
    return createLlmClient({
      feature: 'test',
      anthropicModelEnvName: 'ANTHROPIC_MODEL_TEST',
      defaultAnthropicModel: 'claude-haiku-5-5',
      anthropicTimeoutMs: 10_000,
    });
  }

  it('Claude API で答えられたら Bedrock を呼ばない', async () => {
    mockCreate.mockResolvedValueOnce(anthropicMessage());

    const result = await client().callTool(REQUEST);

    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-haiku-5-5');
    expect(result.content[0]).toMatchObject({ input: { ok: true } });
    expect(mockBedrockSend).not.toHaveBeenCalled();
  });

  it('API キーではなく ID 連携で入り、SDK の再試行はしない', async () => {
    mockCreate.mockResolvedValueOnce(anthropicMessage());

    await client().callTool(REQUEST);

    expect(anthropicOptions[0]).not.toHaveProperty('apiKey');
    expect(anthropicOptions[0]).toMatchObject({
      maxRetries: 0,
      timeout: 10_000,
      credentials: {
        federation: {
          federationRuleId: 'fdrl_test',
          serviceAccountId: 'svac_test',
          baseURL: 'https://api.anthropic.com',
        },
      },
    });
  });

  it('使ったトークン数とキャッシュの効きをログに出す', async () => {
    mockCreate.mockResolvedValueOnce(anthropicMessage());

    await client().callTool(REQUEST);

    const [label, json] = info.mock.calls[0] as [string, string];
    expect(label).toBe('[llm] usage');
    expect(JSON.parse(json)).toMatchObject({
      feature: 'test',
      provider: 'anthropic',
      usage: { input: 100, output: 20, cacheRead: 80, cacheWrite: 0 },
    });
  });

  it('クレジット切れなら Bedrock でやり直し、fallback=true を残す', async () => {
    mockCreate.mockRejectedValueOnce(
      apiError(400, 'Your credit balance is too low to access the Anthropic API.'),
    );
    mockBedrockSend.mockResolvedValueOnce(bedrockResponse());

    const result = await client().callTool(REQUEST);

    expect(result.provider).toBe('bedrock');
    expect(result.model).toBe(BEDROCK_MODEL);
    expect(result.content[0]).toMatchObject({ input: { from: 'bedrock' } });

    const [label, json] = warn.mock.calls[0] as [string, string];
    expect(label).toBe('[llm] fallback');
    expect(JSON.parse(json)).toMatchObject({
      fallback: true,
      feature: 'test',
      errorType: 'credit_balance',
      status: 400,
    });
  });

  it('認証に失敗したら（無効な ID 連携）Bedrock でやり直す', async () => {
    mockCreate.mockRejectedValueOnce(apiError(401, 'invalid token'));
    mockBedrockSend.mockResolvedValueOnce(bedrockResponse());

    const result = await client().callTool(REQUEST);

    expect(result.provider).toBe('bedrock');
    expect(JSON.parse((warn.mock.calls[0] as [string, string])[1])).toMatchObject({
      errorType: 'authentication',
    });
  });

  it('モデルが断ったら Bedrock でやり直す', async () => {
    mockCreate.mockResolvedValueOnce(anthropicMessage({ stop_reason: 'refusal', content: [] }));
    mockBedrockSend.mockResolvedValueOnce(bedrockResponse());

    const result = await client().callTool(REQUEST);

    expect(result.provider).toBe('bedrock');
  });

  it('頼み方の誤り（400）は Bedrock に回さず失敗にする', async () => {
    mockCreate.mockRejectedValueOnce(apiError(400, 'tools.0: invalid schema'));

    await expect(client().callTool(REQUEST)).rejects.toThrow('invalid schema');
    expect(mockBedrockSend).not.toHaveBeenCalled();
  });

  it('ID 連携の値が無ければ Claude API の client を作らず Bedrock で答える', async () => {
    delete process.env.ANTHROPIC_FEDERATION_RULE_ID;
    mockBedrockSend.mockResolvedValueOnce(bedrockResponse());

    const result = await client().callTool(REQUEST);

    expect(result.provider).toBe('bedrock');
    expect(anthropicOptions).toHaveLength(0);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('Bedrock の失敗はそのまま上げる', async () => {
    process.env.LLM_PROVIDER = 'bedrock';
    mockBedrockSend.mockRejectedValueOnce(new Error('AccessDeniedException'));

    await expect(client().callTool(REQUEST)).rejects.toThrow('AccessDeniedException');
  });
});
