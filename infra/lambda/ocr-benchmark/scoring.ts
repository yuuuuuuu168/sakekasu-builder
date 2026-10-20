/**
 * OCR のモデル比較の採点と集計。
 *
 * 正解は保存済みの記録（PurchaseRecord / DrinkingRecord）の値。モデルの読み取り結果は
 * 本番と同じ extractLabelInfo を通したものを比べる。正解が空の項目は採点しない。
 *
 * ここは純粋な関数だけにして、テストから直接呼べるようにしている
 */
import type { ExtractResult } from '../ocr-analyzer/extractLabelInfo.js';

/** 採点する項目。PurchaseRecord / DrinkingRecord と OCR の結果で名前が揃っている */
export const SCORED_FIELDS = [
  'sakeName',
  'category',
  'region',
  'alcoholPercentage',
  'brewery',
  'volumeMl',
  'specificName',
  'ricePolishingRatio',
  'sakeMeterValue',
  'acidity',
  'aminoAcidity',
  'riceVariety',
  'yeast',
] as const;

export type ScoredField = (typeof SCORED_FIELDS)[number];

const NUMERIC_FIELDS = new Set<ScoredField>([
  'alcoholPercentage',
  'volumeMl',
  'ricePolishingRatio',
  'sakeMeterValue',
  'acidity',
  'aminoAcidity',
]);

/**
 * 片方がもう片方を含めば一致とみなす項目。表記の揺れ（「山口県」と「山口」、
 * 「旭酒造株式会社」と「旭酒造」、酒米の並び）が大きく、完全一致では読めているのに外れる
 */
const CONTAINS_FIELDS = new Set<ScoredField>(['region', 'brewery', 'riceVariety', 'yeast']);

/** 数値の一致とみなす差。15.5 と 15.50 のような丸めの違いを吸収する */
const NUMERIC_TOLERANCE = 0.05;

/** 会社の種類の表記。蔵元の比較では落とす */
const COMPANY_SUFFIXES = /(株式会社|有限会社|合名会社|合資会社|\(株\)|\(有\)|\(名\)|\(資\))/g;

/** 全角・半角、大文字・小文字、空白と中黒の違いを均す */
export function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(COMPANY_SUFFIXES, '')
    .replace(/[\s・･·「」『』"'’`]/g, '');
}

/** 文字の 2-gram の Dice 係数（0〜1）。銘柄名の「どれだけ近いか」に使う */
export function similarity(a: string, b: string): number {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = (s: string) => {
    const counts = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i += 1) {
      const gram = s.slice(i, i + 2);
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
    return counts;
  };
  const gx = grams(x);
  const gy = grams(y);
  let overlap = 0;
  for (const [gram, count] of gx) {
    overlap += Math.min(count, gy.get(gram) ?? 0);
  }
  return (2 * overlap) / (x.length - 1 + (y.length - 1));
}

/** 正解の 1 項目が採点の対象になる値か（空・null は対象外） */
function hasTruth(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return typeof value === 'number' && Number.isFinite(value);
}

/** 1 項目の正誤。正解が無ければ undefined（採点しない） */
export function scoreField(field: ScoredField, truth: unknown, predicted: unknown): boolean | undefined {
  if (!hasTruth(truth)) return undefined;
  if (predicted === null || predicted === undefined) return false;
  if (NUMERIC_FIELDS.has(field)) {
    return typeof predicted === 'number' && Math.abs(predicted - Number(truth)) <= NUMERIC_TOLERANCE;
  }
  if (typeof predicted !== 'string') return false;
  const t = normalizeText(String(truth));
  const p = normalizeText(predicted);
  if (t === p) return true;
  if (CONTAINS_FIELDS.has(field) && t !== '' && p !== '') {
    return t.includes(p) || p.includes(t);
  }
  return false;
}

export interface RecordScore {
  /** 採点した項目の正誤（正解が空の項目は入らない） */
  fields: Partial<Record<ScoredField, boolean>>;
  /** 銘柄名の近さ（0〜1）。完全一致でなくても近いかを見る */
  sakeNameSimilarity: number;
}

export function scoreRecord(truth: Record<string, unknown>, predicted: ExtractResult): RecordScore {
  const fields: Partial<Record<ScoredField, boolean>> = {};
  for (const field of SCORED_FIELDS) {
    const result = scoreField(field, truth[field], predicted[field]);
    if (result !== undefined) fields[field] = result;
  }
  const sakeNameSimilarity =
    typeof truth.sakeName === 'string' && predicted.sakeName
      ? similarity(truth.sakeName, predicted.sakeName)
      : 0;
  return { fields, sakeNameSimilarity };
}

/**
 * 1M トークンあたりの単価（USD）。2026-10 時点の Claude API の定価。
 * キャッシュの書き込みは入力の 1.25 倍。表に無いモデルは費用を出さない（トークン数は残る）
 */
export const PRICING: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
};

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export function estimateCostUsd(model: string, usage: Usage): number | null {
  const price = PRICING[model];
  if (!price) return null;
  return (
    (usage.input * price.input +
      usage.output * price.output +
      usage.cacheRead * price.cacheRead +
      usage.cacheWrite * price.input * 1.25) /
    1_000_000
  );
}

/** 1 回の呼び出しの結果 */
export interface CallResult {
  model: string;
  effort: string;
  record: number;
  ms: number;
  usage: Usage;
  costUsd: number | null;
  stopReason: string | null;
  /** 呼び出しの失敗（SDK のエラーの種類）。成功なら undefined */
  error?: string;
  score?: RecordScore;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

const round = (value: number, digits: number) => Number(value.toFixed(digits));

export interface Summary {
  model: string;
  effort: string;
  calls: number;
  errors: number;
  ms: { avg: number; p50: number; p90: number; max: number };
  tokens: Usage;
  costUsd: number | null;
  costPerCallUsd: number | null;
  /** 項目ごとの正解数と採点数 */
  fields: Partial<Record<ScoredField, { correct: number; total: number; rate: number }>>;
  /** 採点したすべての項目を通した正解率 */
  overallRate: number;
  sakeNameSimilarity: number;
}

/** モデルと effort の組ごとにまとめる。並びは呼び出した順の初出順 */
export function summarize(results: CallResult[]): Summary[] {
  const groups = new Map<string, CallResult[]>();
  for (const result of results) {
    const key = `${result.model}|${result.effort}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  return [...groups.values()].map((group) => {
    const ok = group.filter((r) => !r.error);
    const times = ok.map((r) => r.ms).sort((a, b) => a - b);
    const tokens = group.reduce(
      (sum, r) => ({
        input: sum.input + r.usage.input,
        output: sum.output + r.usage.output,
        cacheRead: sum.cacheRead + r.usage.cacheRead,
        cacheWrite: sum.cacheWrite + r.usage.cacheWrite,
      }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    );
    const costs = group.map((r) => r.costUsd);
    const costUsd = costs.some((c) => c === null)
      ? null
      : round(costs.reduce((sum: number, c) => sum + (c ?? 0), 0), 4);

    const fields: Summary['fields'] = {};
    let correctAll = 0;
    let totalAll = 0;
    for (const field of SCORED_FIELDS) {
      const scored = ok.map((r) => r.score?.fields[field]).filter((v) => v !== undefined);
      if (scored.length === 0) continue;
      const correct = scored.filter(Boolean).length;
      fields[field] = { correct, total: scored.length, rate: round(correct / scored.length, 3) };
      correctAll += correct;
      totalAll += scored.length;
    }
    const similarities = ok.map((r) => r.score?.sakeNameSimilarity ?? 0);

    return {
      model: group[0].model,
      effort: group[0].effort,
      calls: group.length,
      errors: group.length - ok.length,
      ms: {
        avg: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
        p50: percentile(times, 50),
        p90: percentile(times, 90),
        max: times.at(-1) ?? 0,
      },
      tokens,
      costUsd,
      costPerCallUsd: costUsd === null || group.length === 0 ? null : round(costUsd / group.length, 5),
      fields,
      overallRate: totalAll ? round(correctAll / totalAll, 3) : 0,
      sakeNameSimilarity: similarities.length
        ? round(similarities.reduce((a, b) => a + b, 0) / similarities.length, 3)
        : 0,
    };
  });
}
