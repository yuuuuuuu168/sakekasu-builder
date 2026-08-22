import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

/**
 * テイスティングノートの裏取りに使う Web 検索（Tavily）。
 *
 * モデルの学習知識だけでは、日本酒の地酒・限定品のように流通の狭い銘柄を
 * ほとんど書けない（実測で日本酒は 33件中1件）。知らない銘柄について
 * 作り話をさせない方針は変えず、代わりに一次情報を引いてから書かせる。
 *
 * ソムリエ（sommelier/app/sommelier/web_search.py）と同じ API・同じ鍵を使う。
 * 方針もそちらに揃える。
 *
 * - 検索は「あると確度が上がる」機能であって安全境界ではない。鍵が無い・
 *   取得に失敗した・検索が失敗した、のいずれでも例外は投げず空で返す。
 *   ノートが書けないだけで、記録の登録も一括追記も止めない
 * - 従量課金なので、件数・深さ・クエリ長・レスポンスサイズはこの
 *   モジュールが固定する。呼び出し側の裁量に任せない
 * - 返す文字列は検索結果そのままではなく、長さを詰めて危険文字を落とす。
 *   これはモデルへ渡すプロンプトの一部になるため
 */

const secretsClient = new SecretsManagerClient({});

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

/** 検索クエリの上限。長文を投げても精度は上がらず費用だけ増える */
const MAX_QUERY_LENGTH = 200;

/** 1回の検索で受け取る件数 */
const MAX_RESULTS = 3;

/** 検索の深さ。advanced は単価が上がる。銘柄を調べる用途では basic で足りる */
const SEARCH_DEPTH = 'basic';

/**
 * 検索結果を寄せる国。指定しないと、日本語で検索しても同じ蔵の海外向けページや
 * 中華圏の日本酒メディアが上位に来る（ソムリエ側で確認済みの挙動）
 */
const SEARCH_COUNTRY = 'japan';

/** 1件あたりの抜粋の長さ。プロンプト全体が検索結果に埋もれないようにする */
const MAX_SNIPPET_LENGTH = 400;
const MAX_TITLE_LENGTH = 120;

/** HTTP のタイムアウト（ミリ秒）。登録の待ち時間に直結するので短く切る */
const HTTP_TIMEOUT_MS = 6000;

/** 読み込むレスポンスの上限バイト数 */
const MAX_RESPONSE_BYTES = 1024 * 1024;

/** 鍵の取得に失敗したあと、再取得を試みないクールダウン（ミリ秒） */
const SECRET_FAILURE_COOLDOWN_MS = 60_000;

/** シークレットを JSON で登録した場合に API キーとみなすキー名 */
const SECRET_JSON_KEYS = ['apiKey', 'api_key', 'TAVILY_API_KEY', 'tavilyApiKey'] as const;

/**
 * API キーとして通す文字。HTTP ヘッダーに載せるので、改行や空白が混ざった値を
 * そのまま渡すとヘッダー分割の材料になる
 */
const API_KEY_PATTERN = /^[A-Za-z0-9\-_.]+$/;

export interface SearchResult {
  title: string;
  snippet: string;
}

/** 検索結果の文字列から、プロンプトの構造を壊しうる文字を落として詰める */
export function cleanText(value: unknown, limit: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  // 山括弧は <web_data> の囲みを抜け出す材料になるので落とす。
  // 中括弧・角括弧・バッククォートは擬似 JSON やコードブロックの材料
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/[<>{}[\]`\\\u0000-\u001f\u007f]/g, ' ');
  return stripped.split(/\s+/).filter(Boolean).join(' ').slice(0, limit);
}

/** シークレットの中身（平文 or JSON）から API キーを取り出す */
export function extractApiKey(secretString: string | undefined): string | null {
  if (!secretString) {
    return null;
  }
  const trimmed = secretString.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        for (const key of SECRET_JSON_KEYS) {
          const value = (parsed as Record<string, unknown>)[key];
          if (typeof value === 'string' && API_KEY_PATTERN.test(value.trim())) {
            return value.trim();
          }
        }
      }
    } catch {
      return null;
    }
    return null;
  }
  return API_KEY_PATTERN.test(trimmed) ? trimmed : null;
}

/** Tavily のレスポンスから、採用できる結果だけを取り出す */
export function extractResults(body: unknown): SearchResult[] {
  if (body === null || typeof body !== 'object') {
    return [];
  }
  const rawResults = (body as { results?: unknown }).results;
  if (!Array.isArray(rawResults)) {
    return [];
  }
  return rawResults
    .slice(0, MAX_RESULTS)
    .map((item) => {
      const record = (item ?? {}) as Record<string, unknown>;
      return {
        title: cleanText(record.title, MAX_TITLE_LENGTH),
        snippet: cleanText(record.content, MAX_SNIPPET_LENGTH),
      };
    })
    .filter((result) => result.snippet !== '');
}

/** 取得済みの API キー。コールドスタートをまたいで使い回す */
let cachedApiKey: string | null = null;
/** 取得に失敗した場合の、次に試してよい時刻（epoch ミリ秒） */
let secretRetryAfter = 0;

/** テストから状態を初期化するための口 */
export function resetSearchState(): void {
  cachedApiKey = null;
  secretRetryAfter = 0;
}

async function loadApiKey(secretId: string, now: number): Promise<string | null> {
  if (cachedApiKey) {
    return cachedApiKey;
  }
  if (now < secretRetryAfter) {
    return null;
  }
  try {
    const response = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: secretId }),
    );
    const apiKey = extractApiKey(response.SecretString);
    if (!apiKey) {
      console.warn('[TastingNote] Tavily の API キーをシークレットから読み取れません');
      secretRetryAfter = now + SECRET_FAILURE_COOLDOWN_MS;
      return null;
    }
    cachedApiKey = apiKey;
    return apiKey;
  } catch (err) {
    // 本文には鍵に関する情報が載りうるので、種類だけ残す
    console.warn('[TastingNote] Tavily の API キーを取得できません:', (err as Error).name);
    secretRetryAfter = now + SECRET_FAILURE_COOLDOWN_MS;
    return null;
  }
}

/**
 * 銘柄名を Web で調べる。
 *
 * 失敗しても投げない。検索できなければ空配列を返し、呼び出し側は
 * 学習知識だけの結果をそのまま使う
 */
export async function searchSake(query: string): Promise<SearchResult[]> {
  const secretId = process.env.TAVILY_API_KEY_SECRET_ID;
  if (!secretId) {
    // 鍵を登録していない環境では検索なしで動く（ローカル・新環境）
    return [];
  }

  const apiKey = await loadApiKey(secretId, Date.now());
  if (!apiKey) {
    return [];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(TAVILY_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: query.slice(0, MAX_QUERY_LENGTH),
        max_results: MAX_RESULTS,
        search_depth: SEARCH_DEPTH,
        country: SEARCH_COUNTRY,
        // 要約の生成と本文の全文取得はどちらも課金と入力量を増やす。
        // 判断はこちらのモデルにさせるので、抜粋だけでよい
        include_answer: false,
        include_raw_content: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // 本文には鍵に関する情報が載りうるので、ステータスだけ残す
      console.warn('[TastingNote] Tavily の検索が失敗しました: HTTP', response.status);
      return [];
    }

    const text = (await response.text()).slice(0, MAX_RESPONSE_BYTES);
    return extractResults(JSON.parse(text));
  } catch (err) {
    console.warn('[TastingNote] Tavily の検索が失敗しました:', (err as Error).name);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
