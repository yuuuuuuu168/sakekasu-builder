// モデルの応答から tool の入力を 1 つだけ取り出す。OCR とテイスティングノートが使う。
//
// llm.ts とは分けてある。テストは llm.ts をまるごとモックに差し替えるので、そこに
// 置くとこの関数までモックの中へ消える。型だけを読むので、llm.ts の SDK は読み込まない
import type { ToolResponse } from './llm';

/**
 * 指定した tool の tool_use ブロックがちょうど 1 つなら、その input を返す。
 *
 * tool_choice で強制しているので通常は 1 つ。max_tokens 到達などで欠けた場合や、
 * 複数返ってきた場合は、どれも採らずに null を返す。複数あるのはインジェクションの
 * 疑いとして扱う（旧 <answer> タグが複数あったときと同じ）。呼び出し側は null を
 * 「読み取れなかった」「書けなかった」として扱う
 *
 * logPrefix はログの先頭に付ける印（`[OCR]` など）
 */
export function pickSingleToolInput(
  response: ToolResponse,
  toolName: string,
  logPrefix: string,
): unknown {
  const toolUseBlocks = response.content.filter(
    (block) => block.type === 'tool_use' && block.name === toolName,
  );
  if (toolUseBlocks.length === 1) {
    return toolUseBlocks[0].input ?? null;
  }
  console.warn(
    `${logPrefix} unexpected tool_use block count:`,
    JSON.stringify({
      count: toolUseBlocks.length,
      stopReason: response.stopReason,
      provider: response.provider,
    }),
  );
  return null;
}
