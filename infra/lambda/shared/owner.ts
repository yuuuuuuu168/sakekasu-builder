// 画像キーの持ち主の確かめ方。presigned-url と ocr-analyzer が同じ規則で使う。
//
// キーは `{sub}/{recordType}/{recordId}/{fileName}` で組み立てるので、
// `${sub}/` の前方一致で持ち主を判定できる。

/** AppSync が Cognito 認可で渡す identity（使う項目だけ） */
export interface AppSyncIdentity {
  sub?: string | null;
}

/**
 * リクエスト元の sub を取り出す。identity が無い呼び出しは弾く。
 *
 * キーの所有者チェックは `${ownerSub}/` の前方一致で行うため、sub が
 * 空文字のまま通ると `/` で始まる任意のキーが一致してしまう。
 * identity が落ちる経路（直接呼び出しなど）でも素の TypeError にせず、
 * 認可エラーとして扱う
 */
export function requireOwnerSub(event: { identity?: AppSyncIdentity | null }): string {
  const ownerSub = event.identity?.sub;

  if (!ownerSub) {
    throw new Error('Unauthorized: missing identity');
  }

  return ownerSub;
}

/**
 * キーがその sub のものか。
 *
 * sub が空なら常に false にする。requireOwnerSub を通さずに呼ばれても、
 * `/` で始まるキーを誰のものとも見なさない
 */
export function isOwnedKey(ownerSub: string, key: string): boolean {
  return ownerSub !== '' && key.startsWith(`${ownerSub}/`);
}

/** キーがその sub のものでなければ認可エラーにする */
export function assertOwnedKey(
  ownerSub: string,
  key: string,
  message = "Unauthorized: cannot access other user's images",
): void {
  if (!isOwnedKey(ownerSub, key)) {
    throw new Error(message);
  }
}
