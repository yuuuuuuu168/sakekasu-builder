import type { ReactNode } from 'react';

/**
 * 本文中の URL をリンクとして描画する。
 *
 * ソムリエは Web 検索の結果を根拠にするとき、出典の URL を本文に載せる
 * （Issue #122）。吹き出しは `whitespace-pre-wrap` の素のテキストなので、
 * そのままでは URL が文字列として並ぶだけで開けない。
 *
 * 変換するのは http / https だけ。`dangerouslySetInnerHTML` は使わず、
 * 分割した文字列から React の要素を組み立てる（応答の文面はモデル経由で
 * 外部サイトの文章にも触れているため、HTML として解釈させない）。
 */

// 末尾の句読点や閉じ括弧は URL に含めない。「〜（https://example.com）」の
// ように書かれたときに、閉じ括弧までリンクに巻き込まないため
const URL_PATTERN = /https?:\/\/[^\s<>"'）」』]+/g;
const TRAILING_CHARS = /[.,;:!?、。）)\]】]+$/;

// リンクにする URL の長さの上限。`web_search.py` の MAX_URL_LENGTH と揃える。
// 検索結果の url 欄は向こうで検証済みだが、ここに来るのはモデルが書いた
// 本文なので、長いクエリ文字列に文脈を詰めた URL も現れうる
const MAX_URL_LENGTH = 500;

/**
 * リンクとして描画してよい URL かを見る。
 *
 * 検索結果の url 欄は `web_search.py` の `_safe_url()` を通っているが、
 * ここに流れてくるのはモデルが書いた本文で、検索結果の抜粋に載っていた
 * URL をそのまま書き写すこともある。上流の検証は当てにせず、描画側でも
 * 同じ線引きをしておく。
 */
function isRenderableUrl(url: string): boolean {
  // 句読点を削った結果スキームだけになったものはリンクにしない
  if (url.length <= 'https://'.length || url.length > MAX_URL_LENGTH) return false;
  // user@host の形は弾く。表示は信頼できるドメインなのに、実際の接続先は
  // アットマークの後ろになる（出典を装ったフィッシングの形）
  const host = url.replace(/^https?:\/\//i, '').split('/')[0];
  return !host.includes('@');
}

export function linkifyText(text: string): ReactNode {
  if (!text) return text;

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  // exec は正規表現に状態を持たせるので、呼ばれるたびに作り直す
  const pattern = new RegExp(URL_PATTERN.source, 'g');
  let match = pattern.exec(text);
  while (match !== null) {
    const url = match[0].replace(TRAILING_CHARS, '');
    // リンクにしなかった URL は、そのまま地の文として残る（lastIndex を進めない）
    if (isRenderableUrl(url)) {
      if (match.index > lastIndex) {
        nodes.push(text.slice(lastIndex, match.index));
      }
      nodes.push(
        <a
          key={`link-${key}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all underline"
        >
          {url}
        </a>,
      );
      key += 1;
      lastIndex = match.index + url.length;
    }
    match = pattern.exec(text);
  }

  if (nodes.length === 0) return text;
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}
