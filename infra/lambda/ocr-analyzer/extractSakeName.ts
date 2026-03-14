/**
 * 銘柄名抽出ロジック
 *
 * Amazon Bedrock（Claude Haiku）のレスポンステキストから、お酒の銘柄名を抽出する。
 * Bedrock は JSON 形式（{"sakeName": "銘柄名"} または {"sakeName": null}）でレスポンスを返す。
 */

export interface ExtractResult {
  sakeName: string | null;
  confidence: number;
  rawTexts: string[];
}

/**
 * Bedrock のレスポンステキストから銘柄名を抽出する
 *
 * 1. レスポンステキスト全体を rawTexts に格納
 * 2. レスポンステキストから JSON をパース
 * 3. sakeName フィールドを取得
 * 4. sakeName が有効な文字列の場合: { sakeName, confidence: 0.9, rawTexts }
 * 5. sakeName が null・空文字列・JSON パース失敗の場合: { sakeName: null, confidence: 0.0, rawTexts }
 */
export function extractSakeName(bedrockResponseText: string): ExtractResult {
  const rawTexts = [bedrockResponseText];

  // 1. まずテキスト全体をそのままJSONパース試行
  const tryParse = (text: string): { sakeName: unknown } | null => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === 'object' && 'sakeName' in parsed) {
        return parsed as { sakeName: unknown };
      }
    } catch {
      // ignore
    }
    return null;
  };

  // 2. テキスト中の {...} ブロックを抽出してパース試行
  const extractJsonBlock = (text: string): { sakeName: unknown } | null => {
    const match = text.match(/\{[^{}]*"sakeName"[^{}]*\}/);
    if (match) {
      return tryParse(match[0]);
    }
    return null;
  };

  const parsed = tryParse(bedrockResponseText) ?? extractJsonBlock(bedrockResponseText);

  if (parsed !== null) {
    const sakeName = parsed.sakeName;
    if (typeof sakeName === 'string' && sakeName.trim().length > 0) {
      return { sakeName: sakeName.trim(), confidence: 0.9, rawTexts };
    }
  }

  return { sakeName: null, confidence: 0.0, rawTexts };
}
