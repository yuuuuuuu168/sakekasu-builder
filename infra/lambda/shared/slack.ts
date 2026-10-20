// Slack の Incoming Webhook へ送る処理。slack-notifier と billing-notifier が使う。
//
// どちらも外部由来の文字列（アラーム名、AWS のサービス名など）を mrkdwn に
// 埋め込むので、無害化と長さの詰め方は同じ規則に揃える。

/** Slack の section text の上限。超えると送信そのものが 400 で失敗する */
export const SLACK_TEXT_LIMIT = 2900;
/** Slack の header text の上限。こちらは section よりずっと短い */
export const SLACK_HEADER_LIMIT = 150;

/**
 * 対になっていないサロゲート（壊れた文字）を落とす。
 *
 * 残したまま JSON にすると `\ud83d` のような不正な文字列になり、
 * Slack に拒否されて通知そのものが失われる。
 * URL 生成でも `encodeURIComponent` が例外を投げるため、早い段階で落とす
 */
export function dropBrokenCharacters(text: string): string {
  let result = '';
  for (const character of text) {
    const code = character.charCodeAt(0);
    const isBroken = character.length === 1 && code >= 0xd800 && code <= 0xdfff;
    if (!isBroken) result += character;
  }
  return result;
}

/**
 * Slack の mrkdwn に埋め込む値を無害化する。
 *
 * mrkdwn は `<URL|文字>` をリンク、`<!channel>` を一斉呼び出しとして解釈する。
 * 通知には外部由来の文字列が入るため、そのまま流すと偽のリンクや
 * 不要なメンションを差し込まれる余地が残る。
 */
export function escapeMrkdwn(text: string): string {
  // 壊れた文字もここで落とす。この関数は mrkdwn に出す値が必ず通るため、
  // 個別に呼ばれた場合（影響リソースの連結など）も取りこぼさない
  return dropBrokenCharacters(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function clip(text: string, limit: number = SLACK_TEXT_LIMIT): string {
  // 元から壊れた文字が混ざっていることがあるので、まず取り除く
  const cleaned = dropBrokenCharacters(text);

  // Slack が数えるのは UTF-16 の単位なので、判定もそれに合わせる
  if (cleaned.length <= limit) return cleaned;

  // ただし切る位置は文字単位で決める。単純に切ると絵文字が分断され、
  // 壊れた片割れが新たに生まれてしまう
  let result = '';
  for (const character of cleaned) {
    // 省略記号の分を残しておく
    if (result.length + character.length > limit - 1) break;
    result += character;
  }
  return `${result}…`;
}

/**
 * mrkdwn に埋め込む値を無害化し、長さも詰める。
 *
 * 二重に適用すると `&lt;` が `&amp;lt;` になって表示が壊れるため、
 * 「mrkdwn として出力する直前に一度だけ」通すこと
 */
export function safeText(text: string, limit: number = SLACK_TEXT_LIMIT): string {
  return clip(escapeMrkdwn(text), limit);
}

/**
 * Webhook URL の取り出し口を作る。取得のたびに SSM を呼ばず、
 * 実行環境が生きている間は使い回す。
 *
 * SSM の呼び出しそのものは各関数に残す。ここで SDK を読み込むと、
 * shared に SSM の依存を足すことになるため
 */
export function createWebhookUrlGetter(
  load: () => Promise<string | null | undefined>,
  parameterName: string,
): () => Promise<string> {
  let cached: string | null = null;
  return async () => {
    if (cached) return cached;
    const value = await load();
    if (!value) {
      throw new Error(`Webhook URL が未設定です: ${parameterName}`);
    }
    cached = value;
    return value;
  };
}

export async function postToSlack(
  webhookUrl: string,
  blocks: unknown[],
  fallbackText: string,
): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // fallbackText は通知プレビューやプッシュ通知に出る。組み立て側で
    // 通し忘れても素通ししないよう、送信の直前でも必ず無害化する
    body: JSON.stringify({ text: safeText(fallbackText, 200), blocks }),
  });

  if (!response.ok) {
    // 本文には Webhook URL を含めない（ログに出さない）
    throw new Error(`Slack への送信に失敗しました (HTTP ${response.status})`);
  }
}
