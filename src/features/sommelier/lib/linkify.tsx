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
    // 句読点を削った結果スキームだけになったものはリンクにしない
    if (url.length > 'https://'.length) {
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
