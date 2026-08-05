import {
  CognitoIdentityProviderClient,
  AdminInitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const cognito = new CognitoIdentityProviderClient({});
const secrets = new SecretsManagerClient({});
const cloudwatch = new CloudWatchClient({});

const METRIC_NAMESPACE = process.env.METRIC_NAMESPACE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;
const USER_POOL_CLIENT_ID = process.env.USER_POOL_CLIENT_ID!;
const CREDENTIALS_SECRET_ID = process.env.CREDENTIALS_SECRET_ID!;
const RUNTIME_ARN = process.env.SOMMELIER_RUNTIME_ARN!;
const RUNTIME_REGION = process.env.SOMMELIER_RUNTIME_REGION ?? 'ap-northeast-1';
const RUNTIME_QUALIFIER = process.env.SOMMELIER_RUNTIME_QUALIFIER ?? 'DEFAULT';
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? '60000');

/** 実際の会話と同じ形で送る。応答は短く済ませてコストを抑える */
const CANARY_PROMPT = '動作確認です。「はい」とだけ返してください。';

interface MonitoringCredentials {
  username: string;
  password: string;
}

async function getCredentials(): Promise<MonitoringCredentials> {
  const result = await secrets.send(
    new GetSecretValueCommand({ SecretId: CREDENTIALS_SECRET_ID }),
  );
  if (!result.SecretString) {
    throw new Error('監視ユーザーの認証情報が空です');
  }
  const parsed = JSON.parse(result.SecretString) as Partial<MonitoringCredentials>;
  if (!parsed.username || !parsed.password) {
    throw new Error('監視ユーザーの認証情報に username / password がありません');
  }
  return { username: parsed.username, password: parsed.password };
}

async function getAccessToken(): Promise<string> {
  const { username, password } = await getCredentials();

  const auth = await cognito.send(
    new AdminInitiateAuthCommand({
      UserPoolId: USER_POOL_ID,
      ClientId: USER_POOL_CLIENT_ID,
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: username, PASSWORD: password },
    }),
  );

  const token = auth.AuthenticationResult?.AccessToken;
  if (!token) {
    // 初回サインイン時のパスワード変更などが残っていると here に来る
    throw new Error(`アクセストークンを取得できませんでした (challenge: ${auth.ChallengeName ?? 'なし'})`);
  }
  return token;
}

function invocationUrl(): string {
  const arn = encodeURIComponent(RUNTIME_ARN);
  // 修飾子も環境変数由来なので、ARN と同じくエスケープしてから URL に載せる
  const qualifier = encodeURIComponent(RUNTIME_QUALIFIER);
  return (
    `https://bedrock-agentcore.${RUNTIME_REGION}.amazonaws.com` +
    `/runtimes/${arn}/invocations?qualifier=${qualifier}`
  );
}

/** フロントと同じく33文字以上のセッション ID が要る。毎回作り直す */
function newSessionId(): string {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

interface CanaryOutcome {
  ok: boolean;
  /** 失敗した段階。auth なら認証、invoke なら Runtime 呼び出し */
  stage?: 'auth' | 'invoke' | 'empty';
  status?: number;
  detail?: string;
  durationMs: number;
  replyLength: number;
}

async function runCanary(): Promise<CanaryOutcome> {
  const startedAt = Date.now();

  let token: string;
  try {
    token = await getAccessToken();
  } catch (err) {
    return {
      ok: false,
      stage: 'auth',
      detail: err instanceof Error ? err.message : '認証に失敗しました',
      durationMs: Date.now() - startedAt,
      replyLength: 0,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(invocationUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': newSessionId(),
      },
      body: JSON.stringify({ prompt: CANARY_PROMPT, history: [] }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        stage: 'invoke',
        status: response.status,
        detail: `Runtime が HTTP ${response.status} を返しました`,
        durationMs: Date.now() - startedAt,
        replyLength: 0,
      };
    }

    const body = await response.text();
    // SSE の data 行から本文だけを取り出す
    const reply = body
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .map((payload) => {
        try {
          const parsed: unknown = JSON.parse(payload);
          return typeof parsed === 'string' ? parsed : '';
        } catch {
          return '';
        }
      })
      .join('');

    if (reply.trim().length === 0) {
      return {
        ok: false,
        stage: 'empty',
        status: response.status,
        detail: '応答が空でした',
        durationMs: Date.now() - startedAt,
        replyLength: 0,
      };
    }

    return { ok: true, durationMs: Date.now() - startedAt, replyLength: reply.length };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      stage: 'invoke',
      detail: aborted ? `${TIMEOUT_MS}ms 以内に応答がありませんでした` : '接続できませんでした',
      durationMs: Date.now() - startedAt,
      replyLength: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

export const handler = async (): Promise<CanaryOutcome> => {
  const outcome = await runCanary();

  await cloudwatch.send(
    new PutMetricDataCommand({
      Namespace: METRIC_NAMESPACE,
      MetricData: [
        {
          MetricName: 'SommelierCanaryFailed',
          Value: outcome.ok ? 0 : 1,
          Unit: 'Count',
        },
        {
          MetricName: 'SommelierCanaryLatency',
          Value: outcome.durationMs,
          Unit: 'Milliseconds',
        },
      ],
    }),
  );

  if (!outcome.ok) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        action: 'sommelierCanary',
        stage: outcome.stage,
        status: outcome.status,
        detail: outcome.detail,
      }),
    );
  }

  return outcome;
};
