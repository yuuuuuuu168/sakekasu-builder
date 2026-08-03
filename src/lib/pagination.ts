/** 1ページあたりの取得件数 */
export const PAGE_LIMIT = 100;

/** 無限ループ防止の最大ページ数（100件 × 20 = 最大2000件） */
export const MAX_PAGES = 20;

export interface Page<T> {
  items: T[];
  nextToken: string | null;
}

/**
 * nextToken がなくなるまでページを取得して全件を結合する。
 *
 * - fetchPage が undefined/null を返した場合（レスポンス欠損）はそこで打ち切る
 * - MAX_PAGES を超えた場合は打ち切り、console.warn で通知する（静かな欠落を防ぐ）
 */
export async function fetchAllPages<T>(
  fetchPage: (nextToken: string | null) => Promise<Page<T> | null | undefined>,
): Promise<T[]> {
  const allItems: T[] = [];
  let nextToken: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetchPage(nextToken);
    if (!result) break;

    allItems.push(...result.items);
    nextToken = result.nextToken ?? null;
    if (!nextToken) return allItems;
  }

  if (nextToken) {
    console.warn(
      `fetchAllPages: ${MAX_PAGES}ページ（${allItems.length}件）で取得を打ち切りました。未取得の記録があります`,
    );
  }
  return allItems;
}
