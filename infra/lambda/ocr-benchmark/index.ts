/**
 * OCR のモデル比較（手動で起動する）。
 *
 * 保存済みの記録の画像を、本番の OCR と同じ頼み方（tool と指示文）で複数のモデルに読ませ、
 * 記録に保存された値を正解として、項目ごとの正解率・応答時間・トークン数・費用を比べる。
 *
 * - 本番の OCR とは別の関数で、AppSync からは呼べない。起動は ocr-benchmark.yml か、
 *   AWS コンソール・CLI からの直接の invoke だけ
 * - Claude API で失敗しても Bedrock でやり直さない。比べたいのは指定したモデルなので、
 *   失敗はそのまま失敗として数える（流量の上限・過負荷は SDK の再試行で待つ）
 * - ログにはラベルの文面・銘柄名・画像のキーを出さない。出すのは正誤と数値だけ
 *   （本番の OCR と同じ方針）
 */
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import {
  LABEL_TOOL_NAME,
  MAX_OCR_IMAGES,
  assertImagesAreRealImages,
  assertImagesFitBedrockLimit,
  assertStoredImageFitsBedrockLimit,
  buildLabelRequest,
  resolveMediaType,
} from '../ocr-analyzer/index.js';
import { extractLabelInfo } from '../ocr-analyzer/extractLabelInfo.js';
import {
  buildAnthropicRequest,
  createAnthropicClient,
  readLlmConfig,
  type Effort,
} from '../shared/llm';
import { estimateCostUsd, scoreRecord, summarize, type CallResult } from './scoring.js';

// SDK は lambda/shared の依存にある。ここで直に import すると別の版が束ねられうるので、
// 型は shared の関数から取る
type Anthropic = ReturnType<typeof createAnthropicClient>;

const s3 = new S3Client({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const DEFAULT_MODELS = [
  'claude-haiku-5-5',
  'claude-sonnet-5-5',
  'claude-opus-5-5',
  'claude-fable-5-1',
];
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const MODEL_ID = /^claude-[a-z0-9-]{1,60}$/;

/** 1 回の呼び出しの待ち時間。Fable を high 以上で回すと 1 分を超えることがある */
const CALL_TIMEOUT_MS = 180_000;
/**
 * 1 回の呼び出しの出力の上限。本番（3,072）は思考の少ない Haiku の low に合わせた値で、
 * Opus・Fable や高い effort では思考で使い切って tool_use が欠ける。比較では広げる
 */
const MAX_TOKENS = 16_000;
/** 残り時間がこれを切ったら新しい呼び出しを始めない（1 回の待ち時間 + 集計の余裕） */
const STOP_MARGIN_MS = CALL_TIMEOUT_MS + 20_000;

export interface BenchmarkEvent {
  /** 比べるモデル。省けば DEFAULT_MODELS */
  models?: string[];
  /** 比べる effort。省けば low（本番と同じ） */
  efforts?: string[];
  /** 何件の記録を使うか（新しい順）。省けば 30 */
  limit?: number;
  /** 新しい順に何件飛ばすか。2 回目以降に別の記録で回すときに使う */
  offset?: number;
  /** 同時に投げる数。省けば 8 */
  concurrency?: number;
}

interface LambdaContext {
  getRemainingTimeInMillis(): number;
}

interface BenchmarkRecord {
  truth: Record<string, unknown>;
  imageKeys: string[];
}

export interface Plan {
  models: string[];
  efforts: Effort[];
  limit: number;
  offset: number;
  concurrency: number;
}

/** 入力を確かめて既定値を埋める。モデル名と effort は決まった形のものしか通さない */
export function resolvePlan(event: BenchmarkEvent | null | undefined): Plan {
  const models = event?.models?.length ? event.models : DEFAULT_MODELS;
  for (const model of models) {
    if (!MODEL_ID.test(model)) throw new Error(`モデル名が不正です: ${JSON.stringify(model)}`);
  }
  const efforts = (event?.efforts?.length ? event.efforts : ['low']).map((effort) => {
    if (!EFFORTS.includes(effort as Effort)) {
      throw new Error(`effort が不正です: ${JSON.stringify(effort)}（${EFFORTS.join(' / ')}）`);
    }
    return effort as Effort;
  });
  const int = (value: unknown, fallback: number, min: number, max: number) => {
    const n = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(n) || n < min || n > max) {
      throw new Error(`値が範囲外です: ${JSON.stringify(value)}（${min}〜${max}）`);
    }
    return n;
  };
  return {
    models: [...new Set(models)],
    efforts: [...new Set(efforts)],
    limit: int(event?.limit, 30, 1, 500),
    offset: int(event?.offset, 0, 0, 10_000),
    concurrency: int(event?.concurrency, 8, 1, 32),
  };
}

async function scanAll(tableName: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const out = await dynamo.send(new ScanCommand({ TableName: tableName, ExclusiveStartKey: startKey }));
    items.push(...((out.Items ?? []) as Record<string, unknown>[]));
    startKey = out.LastEvaluatedKey;
  } while (startKey);
  return items;
}

function imageKeysOf(item: Record<string, unknown>): string[] {
  const keys = Array.isArray(item.imageKeys)
    ? item.imageKeys.filter((key): key is string => typeof key === 'string' && key !== '')
    : [];
  if (keys.length === 0 && typeof item.imageKey === 'string' && item.imageKey !== '') {
    keys.push(item.imageKey);
  }
  return keys.slice(0, MAX_OCR_IMAGES);
}

/**
 * 正解に使う記録を選ぶ。画像と銘柄名があるものを新しい順に並べ、offset から limit 件。
 * 在庫から飲んだ記録（purchaseRecordId あり）は、元の購入の記録が対象にあれば外す
 * （画像を引き継いでいるので同じラベルを二度数えることになる）
 */
export function selectRecords(
  purchases: Record<string, unknown>[],
  drinkings: Record<string, unknown>[],
  offset: number,
  limit: number,
): BenchmarkRecord[] {
  const usable = (item: Record<string, unknown>) =>
    typeof item.sakeName === 'string' && item.sakeName.trim() !== '' && imageKeysOf(item).length > 0;
  const purchaseIds = new Set(purchases.filter(usable).map((item) => item.id));
  const candidates = [
    ...purchases.filter(usable),
    ...drinkings.filter(
      (item) => usable(item) && !(item.purchaseRecordId && purchaseIds.has(item.purchaseRecordId)),
    ),
  ];
  candidates.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  return candidates.slice(offset, offset + limit).map((item) => ({
    truth: item,
    imageKeys: imageKeysOf(item),
  }));
}

/** 本番の OCR と同じ検査を通して、送れる形の画像にする */
async function loadImages(keys: string[]): Promise<{ base64: string; mediaType: string }[]> {
  const stored = [];
  for (const [index, key] of keys.entries()) {
    const out = await s3.send(new GetObjectCommand({ Bucket: process.env.BUCKET_NAME, Key: key }));
    try {
      assertStoredImageFitsBedrockLimit(index, out.ContentLength);
    } catch (error) {
      (out.Body as { destroy?: () => void } | undefined)?.destroy?.();
      throw error;
    }
    stored.push({ bytes: await out.Body!.transformToByteArray(), contentType: out.ContentType });
  }
  const validated = stored.map(({ bytes, contentType }) => ({
    bytes,
    mediaType: resolveMediaType(contentType),
  }));
  assertImagesAreRealImages(validated);
  const images = validated.map(({ bytes, mediaType }) => ({
    base64: Buffer.from(bytes).toString('base64'),
    mediaType,
  }));
  assertImagesFitBedrockLimit(images);
  return images;
}

/** ログに出す失敗の種類。SDK のエラーなら状態コード、それ以外は名前だけ（本文は出さない） */
export function errorLabel(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown';
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? `${error.constructor.name}:${status}` : error.constructor.name;
}

async function callModel(
  client: Anthropic,
  model: string,
  effort: Effort,
  record: number,
  images: { base64: string; mediaType: string }[],
  truth: Record<string, unknown>,
): Promise<CallResult> {
  const request = { ...buildLabelRequest(images), maxTokens: MAX_TOKENS };
  const started = Date.now();
  const empty = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  try {
    const message = await client.messages.create(buildAnthropicRequest(model, request, effort));
    const ms = Date.now() - started;
    const usage = {
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
      cacheRead: message.usage.cache_read_input_tokens ?? 0,
      cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
    };
    const toolUses = message.content.filter(
      (block) => block.type === 'tool_use' && block.name === LABEL_TOOL_NAME,
    );
    // 本番と同じく、tool_use がちょうど 1 つのときだけ採る。欠けたら全項目外れとして数える
    const toolInput = toolUses.length === 1 && toolUses[0].type === 'tool_use' ? toolUses[0].input : null;
    return {
      model,
      effort,
      record,
      ms,
      usage,
      costUsd: estimateCostUsd(model, usage),
      stopReason: message.stop_reason,
      // 断られたのは読み違いではないので、正解率からは外して失敗として数える（費用は残す）
      ...(message.stop_reason === 'refusal'
        ? { error: 'refusal' }
        : { score: scoreRecord(truth, extractLabelInfo(toolInput)) }),
    };
  } catch (error) {
    return {
      model,
      effort,
      record,
      ms: Date.now() - started,
      usage: empty,
      costUsd: 0,
      stopReason: null,
      error: errorLabel(error),
    };
  }
}

/** Models API で今使えるモデルを出す。Fable の新しい版が出ていないかを見るため。失敗しても止めない */
async function listModels(client: Anthropic): Promise<string[]> {
  try {
    const ids: string[] = [];
    for await (const model of client.models.list()) ids.push(model.id);
    return ids;
  } catch (error) {
    console.warn('[bench] models.list failed', errorLabel(error));
    return [];
  }
}

export async function handler(event: BenchmarkEvent, context: LambdaContext) {
  const plan = resolvePlan(event);
  const config = readLlmConfig('ANTHROPIC_MODEL_OCR', DEFAULT_MODELS[0]);
  if (!config.federation) {
    throw new Error('Claude API の ID 連携の値が無い環境では比較できません（cdk.json の anthropicFederation）');
  }
  const client = createAnthropicClient(config.federation, CALL_TIMEOUT_MS, 2);

  const availableModels = await listModels(client);
  console.info('[bench] start', JSON.stringify({ plan, availableModels }));

  const [purchases, drinkings] = await Promise.all([
    scanAll(process.env.PURCHASE_TABLE_NAME!),
    scanAll(process.env.DRINKING_TABLE_NAME!),
  ]);
  const records = selectRecords(purchases, drinkings, plan.offset, plan.limit);

  // 記録ごとにモデルと effort を並べる。途中で時間切れになっても、どの組も同じ記録で比べられる
  const tasks = records.flatMap((_, record) =>
    plan.models.flatMap((model) => plan.efforts.map((effort) => ({ record, model, effort }))),
  );
  console.info(
    '[bench] plan',
    JSON.stringify({ candidates: purchases.length + drinkings.length, records: records.length, calls: tasks.length }),
  );

  // 画像は記録ごとに 1 度だけ読み、その記録の呼び出しが全部終わったら手放す
  const images = new Map<number, Promise<{ base64: string; mediaType: string }[]>>();
  const pending = new Map<number, number>();
  for (const task of tasks) pending.set(task.record, (pending.get(task.record) ?? 0) + 1);

  const results: CallResult[] = [];
  let skipped = 0;
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next];
      next += 1;
      if (context.getRemainingTimeInMillis() < STOP_MARGIN_MS) {
        skipped += 1;
        continue;
      }
      let loaded = images.get(task.record);
      if (!loaded) {
        loaded = loadImages(records[task.record].imageKeys);
        images.set(task.record, loaded);
      }
      let result: CallResult;
      try {
        result = await callModel(
          client,
          task.model,
          task.effort,
          task.record,
          await loaded,
          records[task.record].truth,
        );
      } catch (error) {
        // 画像の取得・検査で落ちた。モデルのせいではないので集計から外す
        console.warn('[bench] image skipped', JSON.stringify({ record: task.record, error: errorLabel(error) }));
        skipped += 1;
        continue;
      } finally {
        const left = (pending.get(task.record) ?? 1) - 1;
        pending.set(task.record, left);
        if (left === 0) images.delete(task.record);
      }
      results.push(result);
      console.info('[bench] call', JSON.stringify(result));
    }
  };
  await Promise.all(Array.from({ length: plan.concurrency }, worker));

  const summaries = summarize(results);
  const totalCostUsd = Number(
    results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0).toFixed(4),
  );
  for (const summary of summaries) {
    console.info('[bench] summary', JSON.stringify(summary));
  }
  const report = {
    plan,
    records: records.length,
    plannedCalls: tasks.length,
    completedCalls: results.length,
    skipped,
    totalCostUsd,
    availableModels,
    summaries,
  };
  console.info('[bench] done', JSON.stringify({ ...report, summaries: undefined }));
  return report;
}
