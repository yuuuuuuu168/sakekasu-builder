/**
 * 一覧での備考の見せ方に関する判定。
 *
 * コンポーネントから切り出しているのは、判定だけを単体で確かめられるように
 * するため（コンポーネントのファイルから関数を export すると Fast Refresh も効かなくなる）。
 */

/**
 * 折りたたむ長さのめやす。
 *
 * カードの幅は画面によって変わるので、何行に折り返るかは事前に分からない。
 * 実際の高さを測って判断する手もあるが、テイスティングノートが入った備考は
 * ほぼ確実に複数行になるため、長さと改行だけで決める。
 * 短い備考は折りたたまず、そのまま全文を出す
 */
const COLLAPSE_MIN_LENGTH = 40;

/** 折りたたんで表示する備考か */
export function isCollapsibleMemo(memo: string): boolean {
  return memo.includes('\n') || memo.length > COLLAPSE_MIN_LENGTH;
}
