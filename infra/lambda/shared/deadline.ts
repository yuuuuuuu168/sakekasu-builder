// Lambda の残り時間から、外部呼び出しの締め切りを決める。OCR とテイスティングノートが使う。

/** Lambda の context のうち使うところだけ */
export interface RemainingTime {
  getRemainingTimeInMillis(): number;
}

/**
 * Lambda の残り時間から締め切り（Date.now() の値）を決める。結果を返したりログを
 * 書いたりする分として reserveMs を残す。context が無い呼び出し（テストなど）では
 * 締め切りを付けない
 */
export function deadlineFrom(
  context: RemainingTime | undefined,
  reserveMs = 1_000,
): number | undefined {
  if (!context) return undefined;
  return Date.now() + context.getRemainingTimeInMillis() - reserveMs;
}
