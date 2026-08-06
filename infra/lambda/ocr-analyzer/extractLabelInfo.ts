/**
 * ラベル情報抽出ロジック
 *
 * Amazon Bedrock（Claude Haiku）のレスポンステキストから、お酒のラベル情報
 * （銘柄名・カテゴリ・産地・アルコール度数）を抽出する。
 * Bedrock はラベルの転記テキストに続けて、<answer> タグで囲んだ JSON
 * （{"sakeName": ..., "category": ..., "region": ..., "alcoholPercentage": ...}）を返す。
 */

export type SakeCategory = 'NIHONSHU' | 'BEER' | 'WINE' | 'WHISKY' | 'SHOCHU' | 'OTHER';

const SAKE_CATEGORIES: readonly string[] = [
  'NIHONSHU',
  'BEER',
  'WINE',
  'WHISKY',
  'SHOCHU',
  'OTHER',
];

export interface ExtractResult {
  sakeName: string | null;
  category: SakeCategory | null;
  region: string | null;
  alcoholPercentage: number | null;
  confidence: number;
  rawTexts: string[];
}

/** 有効な非空文字列なら trim して返す。それ以外は null */
function asTrimmedString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

/** SakeCategory 列挙値として有効なら返す。それ以外は null */
function asCategory(value: unknown): SakeCategory | null {
  if (typeof value === 'string' && SAKE_CATEGORIES.includes(value.toUpperCase())) {
    return value.toUpperCase() as SakeCategory;
  }
  return null;
}

/** アルコール度数として妥当（0 より大きく 100 以下の数値）なら返す。それ以外は null */
function asAlcoholPercentage(value: unknown): number | null {
  const num =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (Number.isFinite(num) && num > 0 && num <= 100) {
    return num;
  }
  return null;
}

/**
 * Bedrock のレスポンステキストからラベル情報を抽出する
 *
 * 1. レスポンステキスト全体を rawTexts に格納
 * 2. レスポンステキストから JSON をパース
 * 3. sakeName / category / region / alcoholPercentage フィールドを検証して取得
 * 4. sakeName が有効な文字列の場合: confidence 0.9
 * 5. sakeName が null・空文字列・JSON パース失敗の場合: confidence 0.0
 *    （銘柄名が読み取れないときは他の項目も採用しない）
 */
export function extractLabelInfo(bedrockResponseText: string): ExtractResult {
  const rawTexts = [bedrockResponseText];

  // 1. まずテキスト全体をそのままJSONパース試行
  const tryParse = (text: string): Record<string, unknown> | null => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === 'object' && 'sakeName' in parsed) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
    return null;
  };

  // 2. テキスト中の {...} ブロックを抽出してパース試行
  // 最終判定である「最後の JSON ブロック」から優先して採用する
  const extractJsonBlock = (text: string): Record<string, unknown> | null => {
    const matches = text.match(/\{[^{}]*"sakeName"[^{}]*\}/g) ?? [];
    for (const candidate of matches.reverse()) {
      const parsed = tryParse(candidate);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  };

  // 3. <answer> タグがある場合はその中身だけを解析対象にする。
  // 手順1の転記テキストにはラベル由来の文字列（偽 JSON を印刷した画像による
  // プロンプトインジェクションを含みうる）が入るため、転記部分は絶対に解析しない。
  // 手順2の判定は転記の後に出力されるので、タグが複数あれば最後を採用する。
  const answers = [...bedrockResponseText.matchAll(/<answer>([\s\S]*?)<\/answer>/g)];
  const lastAnswer = answers.length > 0 ? answers[answers.length - 1][1] : null;

  const parsed =
    lastAnswer !== null
      ? tryParse(lastAnswer.trim()) ?? extractJsonBlock(lastAnswer)
      : tryParse(bedrockResponseText) ?? extractJsonBlock(bedrockResponseText);

  if (parsed !== null) {
    const sakeName = asTrimmedString(parsed.sakeName);
    if (sakeName !== null) {
      return {
        sakeName,
        category: asCategory(parsed.category),
        region: asTrimmedString(parsed.region),
        alcoholPercentage: asAlcoholPercentage(parsed.alcoholPercentage),
        confidence: 0.9,
        rawTexts,
      };
    }
  }

  return {
    sakeName: null,
    category: null,
    region: null,
    alcoholPercentage: null,
    confidence: 0.0,
    rawTexts,
  };
}
