import Anthropic from '@anthropic-ai/sdk';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk/core/error';
import { oidcFederationProvider } from '@anthropic-ai/sdk/lib/credentials/oidc-federation';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { GetWebIdentityTokenCommand, STSClient } from '@aws-sdk/client-sts';
import { IDENTITY_TOKEN_AUDIENCE, IDENTITY_TOKEN_SECONDS } from '../../lib/llm-constants';

/**
 * OCR とテイスティングノートが Claude を呼ぶ口。呼び先は 2 つで、どちらにも同じ形
 * （tool を 1 つ渡して、その入力として結果を受け取る）で頼む。
 *
 * - anthropic: Claude API（api.anthropic.com）。Max プランに付く月々のクレジットで払う
 * - bedrock: Amazon Bedrock の Claude。クレジット切れや障害のときの控え
 *
 * Claude API には API キーを持たずに入る（Workload Identity Federation）。この関数のロールで
 * STS の GetWebIdentityToken を呼んで AWS が署名した JWT をもらい、SDK が Anthropic の短命の
 * トークンと交換する。期限が来れば SDK が自分で交換し直す。
 *
 * Claude API が次の理由で失敗したら、同じ頼みを Bedrock でやり直す（fallbackReason）。
 * 残高不足、認証・権限、流量の上限、過負荷・5xx、通信の失敗、トークンの交換の失敗、
 * モデルが断ったとき。それ以外の 4xx はこちらの頼み方の誤りなので、やり直さずに失敗にする
 * （Bedrock でも同じく弾かれるだけで、誤りが見えなくなる）。
 */

export type Provider = 'anthropic' | 'bedrock';

export interface Federation {
  ruleId: string;
  organizationId: string;
  serviceAccountId: string;
  workspaceId?: string;
}

export interface LlmConfig {
  provider: Provider;
  anthropicModel: string;
  bedrockModel: string;
  federation?: Federation;
}

/**
 * 環境変数から呼び先を決める。
 *
 * BEDROCK_MODEL_ID は既定値を持たない（Issue #82）。IAM はこのモデルの ARN だけを
 * 許可しているので、既定値へ落ちると許可されていないモデルを黙って呼びに行き、
 * 設定漏れが AccessDeniedException として出てくる。控えが無い状態では動かさない。
 *
 * LLM_PROVIDER が anthropic（既定）でも、ID 連携の値が揃っていなければ Bedrock だけで動く。
 * Claude Console の設定が済む前の環境でも、機能そのものは止めないため。
 */
export function readLlmConfig(
  anthropicModelEnvName: string,
  defaultAnthropicModel: string,
  env: NodeJS.ProcessEnv = process.env,
): LlmConfig {
  const bedrockModel = env.BEDROCK_MODEL_ID;
  if (!bedrockModel) {
    throw new Error('BEDROCK_MODEL_ID is not set');
  }
  const anthropicModel = env[anthropicModelEnvName] || defaultAnthropicModel;

  const ruleId = env.ANTHROPIC_FEDERATION_RULE_ID;
  const organizationId = env.ANTHROPIC_ORGANIZATION_ID;
  const serviceAccountId = env.ANTHROPIC_SERVICE_ACCOUNT_ID;
  const federation =
    ruleId && organizationId && serviceAccountId
      ? {
          ruleId,
          organizationId,
          serviceAccountId,
          ...(env.ANTHROPIC_WORKSPACE_ID ? { workspaceId: env.ANTHROPIC_WORKSPACE_ID } : {}),
        }
      : undefined;

  const wanted: Provider = env.LLM_PROVIDER === 'bedrock' ? 'bedrock' : 'anthropic';
  const provider: Provider = wanted === 'anthropic' && federation ? 'anthropic' : 'bedrock';
  return { provider, anthropicModel, bedrockModel, ...(federation ? { federation } : {}) };
}

/** モデルが断った（stop_reason が refusal）。Bedrock でやり直す */
export class RefusalError extends Error {}

/**
 * Bedrock でやり直すべき失敗なら、その種類を返す。やり直さない失敗なら undefined。
 * 種類はログ（[llm] fallback）の errorType にそのまま出し、CloudWatch で数える。
 */
export function fallbackReason(error: unknown): string | undefined {
  if (error instanceof RefusalError) return 'refusal';
  if (error instanceof APIConnectionTimeoutError) return 'timeout';
  if (error instanceof APIConnectionError) return 'connection';
  if (error instanceof AuthenticationError) return 'authentication';
  if (error instanceof PermissionDeniedError) return 'permission';
  if (error instanceof RateLimitError) return 'rate_limit';
  if (error instanceof APIError && typeof error.status === 'number') {
    // 残高不足は 400 で返り、本文の文言でしか見分けられない。402 は支払いの問題
    if (error.status === 402) return 'billing';
    if (error.status === 400 && /credit balance is too low/i.test(error.message)) {
      return 'credit_balance';
    }
    if (error.status === 529) return 'overloaded';
    if (error.status >= 500) return 'server_error';
    return undefined;
  }
  // APIError でないもの: STS の失敗、トークンの交換の失敗など。頼み方とは関係が無い
  return 'credentials';
}

/**
 * 結果を受け取る tool を強制できるモデルか。
 *
 * Haiku は `tool_choice: { type: 'tool' }` を受け付ける。Sonnet 5.5 / Opus 5.5 などは 400 を返すので、
 * 精度不足でモデルを上げたときは auto にして、tool の説明文（「必ずこの tool を1回だけ呼び出すこと」）で
 * 呼ばせる。呼ばなかったときは、強制していても欠けたときと同じく「読めなかった」として扱われる
 */
export function canForceToolChoice(model: string): boolean {
  return /^claude-haiku-/.test(model);
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolRequest {
  maxTokens: number;
  tool: ToolDefinition;
  messages: Anthropic.MessageParam[];
}

export interface ToolResponse {
  content: { type: string; name?: string; input?: unknown }[];
  stopReason: string | null;
  provider: Provider;
  model: string;
}

export interface LlmClientOptions {
  /** ログの区別に使う機能名（ocr / tasting-note） */
  feature: string;
  /** Claude API のモデルを入れる環境変数の名前 */
  anthropicModelEnvName: string;
  defaultAnthropicModel: string;
  /**
   * Claude API の 1 回の待ち時間。AppSync の Lambda リゾルバは 30 秒で打ち切られるので、
   * 失敗したときに Bedrock でやり直す時間が残る長さにする
   */
  anthropicTimeoutMs: number;
}

export interface LlmClient {
  callTool(request: ToolRequest): Promise<ToolResponse>;
}

/**
 * 呼び出し口を作る。環境変数は最初の呼び出しで読む。
 * import した時点で読むと、設定を持たないテスト（画像の検証など）まで巻き込んで落ちる
 */
export function createLlmClient(options: LlmClientOptions): LlmClient {
  let state:
    | { config: LlmConfig; bedrock: BedrockRuntimeClient; anthropic?: Anthropic }
    | undefined;

  function init() {
    if (!state) {
      const config = readLlmConfig(options.anthropicModelEnvName, options.defaultAnthropicModel);
      state = {
        config,
        bedrock: new BedrockRuntimeClient({}),
        ...(config.provider === 'anthropic' && config.federation
          ? { anthropic: createAnthropicClient(config.federation, options.anthropicTimeoutMs) }
          : {}),
      };
    }
    return state;
  }

  return {
    async callTool(request) {
      const { config, bedrock, anthropic } = init();
      if (anthropic) {
        try {
          return await viaAnthropic(anthropic, config.anthropicModel, request, options.feature);
        } catch (error) {
          const reason = fallbackReason(error);
          if (!reason) throw error;
          logFallback(options.feature, reason, error);
        }
      }
      return viaBedrock(bedrock, config.bedrockModel, request, options.feature);
    },
  };
}

function createAnthropicClient(federation: Federation, timeoutMs: number): Anthropic {
  // GetWebIdentityToken は地域ごとの STS にしかない。発行者 URL は global なので、どの地域で呼んでも同じ
  const sts = new STSClient({ region: process.env.AWS_REGION });
  return new Anthropic({
    // ログの水準は既定（warn）のまま。debug にすると本文とヘッダが CloudWatch に出る
    timeout: timeoutMs,
    // 再試行は SDK に任せず、失敗したら Bedrock でやり直す。30 秒の枠に収めるため
    maxRetries: 0,
    credentials: oidcFederationProvider({
      // 交換のたびに新しい JWT を取る（jti は使い回すと弾かれる）
      identityTokenProvider: async () => {
        const out = await sts.send(
          new GetWebIdentityTokenCommand({
            Audience: [IDENTITY_TOKEN_AUDIENCE],
            SigningAlgorithm: 'RS256',
            DurationSeconds: IDENTITY_TOKEN_SECONDS,
          }),
        );
        if (!out.WebIdentityToken) throw new Error('STS が ID トークンを返しませんでした');
        return out.WebIdentityToken;
      },
      federationRuleId: federation.ruleId,
      organizationId: federation.organizationId,
      serviceAccountId: federation.serviceAccountId,
      workspaceId: federation.workspaceId,
      baseURL: 'https://api.anthropic.com',
      fetch,
    }),
  });
}

/**
 * Claude API 向けの頼み方。Bedrock 向けとの違いは 3 つ。
 *
 * - temperature を渡さない。今の世代は既定値以外を 400 で弾く
 * - tool の定義にキャッシュの印を付ける。定義は毎回同じで、連続した呼び出し
 *   （ノートの「知識 → 検索つき」の 2 回、続けて撮った OCR）で読み直しが安くなる
 * - effort を low にする。読み取りと短文の生成で、考え込む余地が少ない
 */
export function buildAnthropicRequest(
  model: string,
  request: ToolRequest,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: request.maxTokens,
    tools: [{ ...request.tool, cache_control: { type: 'ephemeral' } } as Anthropic.Tool],
    tool_choice: canForceToolChoice(model)
      ? { type: 'tool', name: request.tool.name }
      : { type: 'auto' },
    output_config: { effort: 'low' },
    messages: request.messages,
  };
}

/** Bedrock 向けの頼み方。切り替え前と同じ（決定的に近い出力・tool の強制） */
export function buildBedrockRequest(request: ToolRequest): Record<string, unknown> {
  return {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: request.maxTokens,
    temperature: 0,
    tools: [request.tool],
    tool_choice: { type: 'tool', name: request.tool.name },
    messages: request.messages,
  };
}

async function viaAnthropic(
  client: Anthropic,
  model: string,
  request: ToolRequest,
  feature: string,
): Promise<ToolResponse> {
  const started = Date.now();
  const message = await client.messages.create(buildAnthropicRequest(model, request));
  logUsage({
    feature,
    provider: 'anthropic',
    model,
    ms: Date.now() - started,
    stopReason: message.stop_reason,
    usage: {
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
      cacheRead: message.usage.cache_read_input_tokens ?? 0,
      cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
    },
  });
  if (message.stop_reason === 'refusal') {
    throw new RefusalError('モデルが応答を断りました');
  }
  return {
    content: message.content as ToolResponse['content'],
    stopReason: message.stop_reason,
    provider: 'anthropic',
    model,
  };
}

async function viaBedrock(
  client: BedrockRuntimeClient,
  model: string,
  request: ToolRequest,
  feature: string,
): Promise<ToolResponse> {
  const started = Date.now();
  const response = await client.send(
    new InvokeModelCommand({
      modelId: model,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(buildBedrockRequest(request)),
    }),
  );
  const payload = JSON.parse(new TextDecoder().decode(response.body)) as {
    content?: ToolResponse['content'];
    stop_reason?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  logUsage({
    feature,
    provider: 'bedrock',
    model,
    ms: Date.now() - started,
    stopReason: payload.stop_reason ?? null,
    usage: {
      input: payload.usage?.input_tokens ?? 0,
      output: payload.usage?.output_tokens ?? 0,
      cacheRead: payload.usage?.cache_read_input_tokens ?? 0,
      cacheWrite: payload.usage?.cache_creation_input_tokens ?? 0,
    },
  });
  return {
    content: payload.content ?? [],
    stopReason: payload.stop_reason ?? null,
    provider: 'bedrock',
    model,
  };
}

/**
 * 1 回の呼び出しの消費。1 行の JSON にして、CloudWatch Logs Insights で呼び先ごとの
 * トークン数・キャッシュの効き・時間を集計できるようにする。頼んだ中身と応答は出さない
 */
function logUsage(entry: {
  feature: string;
  provider: Provider;
  model: string;
  ms: number;
  stopReason: string | null;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}): void {
  console.info('[llm] usage', JSON.stringify(entry));
}

/**
 * Claude API から Bedrock へ回したことを残す。CDK のメトリクスフィルタが「[llm] fallback」を数え、
 * アラームにする（api-stack.ts）。文言を変えるときはフィルタも合わせる
 */
function logFallback(feature: string, reason: string, error: unknown): void {
  console.warn(
    '[llm] fallback',
    JSON.stringify({
      fallback: true,
      feature,
      from: 'anthropic',
      to: 'bedrock',
      errorType: reason,
      status: error instanceof APIError ? error.status : undefined,
      // 本文が長いエラーもあるので切る。頼んだ中身は SDK のエラーには入らない
      message: error instanceof Error ? error.message.slice(0, 300) : String(error),
    }),
  );
}
