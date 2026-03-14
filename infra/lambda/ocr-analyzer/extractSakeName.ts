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

  try {
    const parsed: unknown = JSON.parse(bedrockResponseText);

    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'sakeName' in parsed
    ) {
      const sakeName = (parsed as { sakeName: unknown }).sakeName;

      if (typeof sakeName === 'string' && sakeName.length > 0) {
        return { sakeName, confidence: 0.9, rawTexts };
      }
    }

    return { sakeName: null, confidence: 0.0, rawTexts };
  } catch {
    return { sakeName: null, confidence: 0.0, rawTexts };
  }
}
