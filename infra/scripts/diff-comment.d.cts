/** {@link ./diff-comment.cjs} の型。ワークフローの github-script から require される */

export declare const COMMENT_LIMIT: number;
export declare const FENCE_MAX: number;

export declare function longestBacktickRun(text: string): number;
export declare function fenceFor(text: string): string;
export declare function breakLongBacktickRuns(text: string): string;

export declare function buildComment(options: {
  /** `cdkd diff` の生の出力 */
  raw: string;
  /** 既存コメントを見つけるための目印 */
  marker: string;
  /** 見出し（既定 `## cdkd diff`） */
  heading?: string;
  /** 本文の切り詰め先（既定 60000） */
  limit?: number;
}): string;
