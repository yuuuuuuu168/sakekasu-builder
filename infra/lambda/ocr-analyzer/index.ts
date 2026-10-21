import {
  extractLabelInfo,
  SPEC_FIELD_NAMES,
  type SakeCategory,
  type FieldConfidence,
  type SpecFields,
} from './extractLabelInfo.js';
import { fetchStoredImages, validateImageKeyAccess } from './imageStore.js';
import {
  assertImagesAreRealImages,
  assertImagesFitBedrockLimit,
  resolveMediaType,
} from './imageValidation.js';
import { buildLabelRequest, LABEL_TOOL_NAME } from './labelRequest.js';
import { deadlineFrom, type RemainingTime } from '../shared/deadline';
import { createLlmClient } from '../shared/llm';
import { requireOwnerSub, type AppSyncIdentity } from '../shared/owner';
import { DEFAULT_ANTHROPIC_MODEL_OCR } from '../../lib/llm-constants';

/**
 * ラベルを読むモデルの呼び出し口。モデルは ANTHROPIC_MODEL_OCR、控えは BEDROCK_MODEL_ID。
 *
 * Claude API の待ち時間は 14 秒まで。AppSync の Lambda リゾルバは 30 秒で打ち切られる
 * （Lambda のタイムアウトも 30 秒）。失敗したときに Bedrock でやり直す時間を残す。
 * 実測では Haiku が 3 枚読んで数秒で返るので、14 秒で切れるのは障害のときだけ
 */
const llm = createLlmClient({
  feature: 'ocr',
  anthropicModelEnvName: 'ANTHROPIC_MODEL_OCR',
  defaultAnthropicModel: DEFAULT_ANTHROPIC_MODEL_OCR,
  anthropicTimeoutMs: 14_000,
  // 1 回あたりの上限。実際には Lambda の残り時間（handler の deadline）でさらに詰める
  bedrockTimeoutMs: 14_000,
});

interface AppSyncEvent {
  info: {
    fieldName: string;
  };
  arguments: {
    imageKey: string;
    additionalImageKeys?: string[] | null;
  };
  // identity が入らない経路もあるので、型でも入らない前提にする（presigned-url と同じ）
  identity?: AppSyncIdentity | null;
}

/** 1リクエストで解析する画像の上限（トークン量とコストを抑える） */
const MAX_OCR_IMAGES = 3;

interface OcrResult extends SpecFields {
  sakeName: string | null;
  category: SakeCategory | null;
  region: string | null;
  alcoholPercentage: number | null;
  confidence: number;
  fieldConfidence: FieldConfidence;
  rawTexts: string[];
}

export async function handler(event: AppSyncEvent, context?: RemainingTime): Promise<OcrResult> {
  // S3 の取得に時間を取られた分は、モデルの待ち時間から詰める（lambda/shared/llm.ts の CallOptions）
  const deadline = deadlineFrom(context);
  const { imageKey, additionalImageKeys } = event.arguments;
  const sub = requireOwnerSub(event);

  // 表・裏ラベルなど複数画像を上限つきで解析対象にする
  const imageKeys = [imageKey, ...(additionalImageKeys ?? [])].slice(0, MAX_OCR_IMAGES);

  // アクセス制御: 全キーについて imageKey プレフィックスと sub の照合
  for (const key of imageKeys) {
    validateImageKeyAccess(sub, key);
  }

  // S3 から画像を取得する
  const stored = await fetchStoredImages(imageKeys);

  // 取得の失敗と混同しないよう、取り出し終えてから中身を見る。
  // 宣言された形式を確かめ、先頭バイトがそれと一致するかまで見てから
  // base64 にする。非画像を base64 化して Bedrock まで運ばないため
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

  // マルチモーダル解析。Claude API で失敗したら Bedrock でやり直す（lambda/shared/llm.ts）
  let toolInput: unknown = null;
  let provider: string | undefined;
  try {
    const response = await llm.callTool(buildLabelRequest(images), { deadline });
    provider = response.provider;
    // tool_choice で強制しているため通常は必ず tool_use ブロックが1つある。
    // max_tokens 到達などで欠けた場合は toolInput が null のまま → 未検出扱い。
    // 複数ある場合は旧 <answer> タグ複数時と同様、インジェクションの疑いとして
    // どれも採用せず未検出扱いにする（異常検知の不変条件を維持）
    const toolUseBlocks = response.content.filter(
      (block) => block.type === 'tool_use' && block.name === LABEL_TOOL_NAME,
    );
    if (toolUseBlocks.length === 1) {
      toolInput = toolUseBlocks[0].input ?? null;
    } else {
      console.warn(
        '[OCR] unexpected tool_use block count:',
        JSON.stringify({
          count: toolUseBlocks.length,
          stopReason: response.stopReason,
          provider: response.provider,
        }),
      );
    }
  } catch (err) {
    console.error('[OCR] model invocation error:', err);
    throw new Error('OCR analysis failed');
  }

  // ラベル情報を検証・抽出して返却
  const result = extractLabelInfo(toolInput);

  // ログにはラベルの文面（転記テキスト・銘柄名・産地）を残さず、抽出結果のサマリーのみ出力する
  // 文字列の詳細スペック（蔵元・酒米など）は読み取れたかどうかだけを出す。
  // 数値項目はラベルの文面にならないのでそのまま出す
  const specSummary = Object.fromEntries(
    SPEC_FIELD_NAMES.map((field) => {
      const value = result[field];
      return [field, typeof value === 'string' ? '(detected)' : value];
    }),
  );

  console.log(
    '[OCR] extraction summary:',
    JSON.stringify({
      confidence: result.confidence,
      fieldConfidence: result.fieldConfidence,
      sakeNameDetected: result.sakeName !== null,
      category: result.category,
      regionDetected: result.region !== null,
      alcoholPercentage: result.alcoholPercentage,
      ...specSummary,
      provider,
    }),
  );

  return result;
}
