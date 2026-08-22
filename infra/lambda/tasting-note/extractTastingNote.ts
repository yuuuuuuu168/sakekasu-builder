/**
 * テイスティングノート抽出ロジック
 *
 * Amazon Bedrock（Claude Haiku）の tool use 入力（record_tasting_note の input）から、
 * 備考へ書き込むテイスティングノートとおすすめの飲み方を検証・抽出する。
 *
 * tool の input_schema で構造は強制しているが、モデル出力は信頼せずここで再検証する
 * （ocr-analyzer/extractLabelInfo.ts と同じ方針）。
 */

/** ノートを書けるカテゴリ。ここに無いカテゴリは呼び出し自体を受け付けない */
export type NotableCategory = 'NIHONSHU' | 'WHISKY';

export const NOTABLE_CATEGORIES: readonly NotableCategory[] = ['NIHONSHU', 'WHISKY'];

export function isNotableCategory(value: unknown): value is NotableCategory {
  return typeof value === 'string' && (NOTABLE_CATEGORIES as readonly string[]).includes(value);
}

export interface TastingNoteResult {
  /** テイスティングノート。銘柄を知らない・書けない場合は null */
  tastingNote: string | null;
  /** おすすめの飲み方。ウイスキーのときだけ入る（日本酒は常に null） */
  recommendedServing: string | null;
}

const EMPTY_RESULT: TastingNoteResult = {
  tastingNote: null,
  recommendedServing: null,
};

/**
 * モデル出力に混ざりうる、備考に入れたくない記号と制御文字。
 *
 * 備考は画面に出るだけでなく、ソムリエ（AgentCore）へ在庫の情報として渡る。
 * タグや擬似 JSON の断片がそのまま流れると、後段のプロンプトの一部として
 * 読まれる余地を残すので落とす。日本語の文章表現（「」・％・℃）は残す
 */
// eslint-disable-next-line no-control-regex
const DANGEROUS_CHARS = /[<>{}[\]`\\\u0000-\u001f\u007f]/g;

/** ノートの最大長（tool スキーマの maxLength と揃える） */
const TASTING_NOTE_MAX_LENGTH = 300;

/** おすすめの飲み方の最大長（tool スキーマの maxLength と揃える） */
const SERVING_MAX_LENGTH = 200;

/**
 * 1行のテキストとして受け取る。
 *
 * 備考は「1項目 = 1行」で追記するため、改行を含んだまま入れると
 * あとから「テイスティングノート:」の行を見分けられなくなる。危険文字は
 * 空白へ置き換えたうえで、改行と連続空白を1つの空白へ畳む
 */
function asSingleLine(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const sanitized = value.replace(DANGEROUS_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (sanitized.length === 0) {
    return null;
  }
  return sanitized.slice(0, maxLength);
}

/**
 * tool use の input からノートを抽出する。
 *
 * 1. input がオブジェクトでなければ全項目 null
 * 2. `isKnown` が true でなければ全項目 null。知らない銘柄について書かせた文章を
 *    備考に残すと、後から見て「本当にその酒の話なのか」を判断できなくなる。
 *    書けないときは書かない
 * 3. おすすめの飲み方はウイスキーのときだけ採る。日本酒でモデルが返してきても捨てる
 *    （日本酒はテイスティングノートのみ、という要件をここで担保する）
 */
export function extractTastingNote(
  toolInput: unknown,
  category: NotableCategory,
): TastingNoteResult {
  if (toolInput === null || typeof toolInput !== 'object' || Array.isArray(toolInput)) {
    return { ...EMPTY_RESULT };
  }

  const input = toolInput as Record<string, unknown>;

  if (input.isKnown !== true) {
    return { ...EMPTY_RESULT };
  }

  const tastingNote = asSingleLine(input.tastingNote, TASTING_NOTE_MAX_LENGTH);
  if (tastingNote === null) {
    // ノートが無いのに飲み方だけ残っても、備考として意味を成さない
    return { ...EMPTY_RESULT };
  }

  const recommendedServing =
    category === 'WHISKY' ? asSingleLine(input.recommendedServing, SERVING_MAX_LENGTH) : null;

  return { tastingNote, recommendedServing };
}
