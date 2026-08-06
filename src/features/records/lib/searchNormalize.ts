/**
 * 検索語と記録の文字列を突き合わせるための正規化。
 *
 * 銘柄はカタカナで書いたり英字で書いたりと揺れる（アラン / Arran / Allan）。
 * そこで両方を「音のキー」に変換してから比べる。
 *
 * 対応する揺れ:
 *   - ひらがな / カタカナ / 半角カナ  … かなに寄せて統一
 *   - 全角英数 / 半角英数、大文字 / 小文字
 *   - カタカナ / アルファベット      … ローマ字に変換して比較
 *   - l と r、b と v、重複子音、長音  … 日本語話者が書き分けにくい音を同一視
 *
 * 対応しないもの:
 *   - 漢字と読みの対応（獺祭 / だっさい）。読みの辞書が必要なため
 *   - 音そのものがずれる借用語（ビール / Beer）
 */

/** カタカナ1〜2文字をローマ字に置き換える表。長いキーから順に試す */
const KANA_TO_ROMAJI: [string, string][] = [
  // 拗音（2文字）を先に置く
  ['キャ', 'kya'], ['キュ', 'kyu'], ['キョ', 'kyo'],
  ['シャ', 'sha'], ['シュ', 'shu'], ['ショ', 'sho'], ['シェ', 'she'],
  ['チャ', 'cha'], ['チュ', 'chu'], ['チョ', 'cho'], ['チェ', 'che'],
  ['ニャ', 'nya'], ['ニュ', 'nyu'], ['ニョ', 'nyo'],
  ['ヒャ', 'hya'], ['ヒュ', 'hyu'], ['ヒョ', 'hyo'],
  ['ミャ', 'mya'], ['ミュ', 'myu'], ['ミョ', 'myo'],
  ['リャ', 'rya'], ['リュ', 'ryu'], ['リョ', 'ryo'],
  ['ギャ', 'gya'], ['ギュ', 'gyu'], ['ギョ', 'gyo'],
  ['ジャ', 'ja'], ['ジュ', 'ju'], ['ジョ', 'jo'], ['ジェ', 'je'],
  ['ヂャ', 'ja'], ['ヂュ', 'ju'], ['ヂョ', 'jo'],
  ['ビャ', 'bya'], ['ビュ', 'byu'], ['ビョ', 'byo'],
  ['ピャ', 'pya'], ['ピュ', 'pyu'], ['ピョ', 'pyo'],
  ['ファ', 'fa'], ['フィ', 'fi'], ['フェ', 'fe'], ['フォ', 'fo'],
  ['ティ', 'ti'], ['トゥ', 'tu'], ['ディ', 'di'], ['ドゥ', 'du'],
  ['ウィ', 'wi'], ['ウェ', 'we'], ['ウォ', 'wo'],
  ['ヴァ', 'va'], ['ヴィ', 'vi'], ['ヴェ', 've'], ['ヴォ', 'vo'], ['ヴ', 'vu'],
  // 清音
  ['ア', 'a'], ['イ', 'i'], ['ウ', 'u'], ['エ', 'e'], ['オ', 'o'],
  ['カ', 'ka'], ['キ', 'ki'], ['ク', 'ku'], ['ケ', 'ke'], ['コ', 'ko'],
  ['サ', 'sa'], ['シ', 'shi'], ['ス', 'su'], ['セ', 'se'], ['ソ', 'so'],
  ['タ', 'ta'], ['チ', 'chi'], ['ツ', 'tsu'], ['テ', 'te'], ['ト', 'to'],
  ['ナ', 'na'], ['ニ', 'ni'], ['ヌ', 'nu'], ['ネ', 'ne'], ['ノ', 'no'],
  ['ハ', 'ha'], ['ヒ', 'hi'], ['フ', 'fu'], ['ヘ', 'he'], ['ホ', 'ho'],
  ['マ', 'ma'], ['ミ', 'mi'], ['ム', 'mu'], ['メ', 'me'], ['モ', 'mo'],
  ['ヤ', 'ya'], ['ユ', 'yu'], ['ヨ', 'yo'],
  ['ラ', 'ra'], ['リ', 'ri'], ['ル', 'ru'], ['レ', 're'], ['ロ', 'ro'],
  ['ワ', 'wa'], ['ヲ', 'o'], ['ン', 'n'],
  // 濁音・半濁音
  ['ガ', 'ga'], ['ギ', 'gi'], ['グ', 'gu'], ['ゲ', 'ge'], ['ゴ', 'go'],
  ['ザ', 'za'], ['ジ', 'ji'], ['ズ', 'zu'], ['ゼ', 'ze'], ['ゾ', 'zo'],
  ['ダ', 'da'], ['ヂ', 'ji'], ['ヅ', 'zu'], ['デ', 'de'], ['ド', 'do'],
  ['バ', 'ba'], ['ビ', 'bi'], ['ブ', 'bu'], ['ベ', 'be'], ['ボ', 'bo'],
  ['パ', 'pa'], ['ピ', 'pi'], ['プ', 'pu'], ['ペ', 'pe'], ['ポ', 'po'],
  // 小書き（単独で残った場合は通常の音として扱う）
  ['ァ', 'a'], ['ィ', 'i'], ['ゥ', 'u'], ['ェ', 'e'], ['ォ', 'o'],
  ['ャ', 'ya'], ['ュ', 'yu'], ['ョ', 'yo'], ['ヮ', 'wa'],
];

/** 拗音を先に照合したいので、キーの長い順に並べ替えておく */
const ROMAJI_RULES = [...KANA_TO_ROMAJI].sort((a, b) => b[0].length - a[0].length);

/**
 * 表記のゆれだけを揃える（音への変換はしない）。
 * 全角・半角や大文字・小文字の違いを消し、ひらがなをカタカナに寄せる。
 */
export function normalizeText(text: string): string {
  return (
    text
      // 全角英数→半角、半角カナ→全角カナ、濁点の合成もここで揃う
      .normalize('NFKC')
      .toLowerCase()
      // ひらがな→カタカナ（コード上で 0x60 離れている）
      .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
      .trim()
  );
}

/** カタカナ列をローマ字に置き換える。カタカナ以外はそのまま残す */
function kanaToRomaji(text: string): string {
  let out = '';
  let i = 0;

  while (i < text.length) {
    // 促音は次の子音が重なるが、あとで重複子音を畳むのでここでは捨てる
    if (text[i] === 'ッ') {
      i += 1;
      continue;
    }
    // 長音記号も、直前の母音を伸ばすだけなので落とす
    if (text[i] === 'ー') {
      i += 1;
      continue;
    }

    const rule = ROMAJI_RULES.find(([kana]) => text.startsWith(kana, i));
    if (rule) {
      out += rule[1];
      i += rule[0].length;
    } else {
      out += text[i];
      i += 1;
    }
  }

  return out;
}

/**
 * 英語の綴りを、カタカナ側の音に寄せる。
 * カナ表記には現れない綴り（ph, wh, 語末の黙字 e など）を均す
 */
function simplifyEnglishSpelling(text: string): string {
  return (
    text
      .replace(/ph/g, 'f') // Laphroaig → Lafroaig
      .replace(/wh/g, 'w') // whisky → wisky
      .replace(/ck/g, 'k')
      .replace(/qu/g, 'kw')
      .replace(/x/g, 'ks')
      .replace(/c(?=[ei])/g, 's') // ice → ise
      .replace(/c/g, 'k') // cask → kask
      // 語末の e は発音されないことが多い（Bowmore → Bowmor）
      .replace(/e\b/g, '')
  );
}

/**
 * 日本語話者が書き分けにくい音を同一視する。
 * ここを通すと Allan / Arran / アラン がすべて "aran" になる。
 */
function unifySimilarSounds(text: string): string {
  return (
    text
      // ラ行は l とも r とも綴られる
      .replace(/l/g, 'r')
      // ヴ音は b で書かれることが多い（Vodka / ウォッカ）
      .replace(/v/g, 'b')
      // 綴り上の重複（ll, rr, tt）や伸ばした母音（aa, ee）を1つに畳む
      .replace(/(.)\1+/g, '$1')
  );
}

/**
 * 比較用の「音のキー」を作る。
 * 検索語と記録の両方をこれに通してから突き合わせる。
 */
export function toPhoneticKey(text: string): string {
  return unifySimilarSounds(simplifyEnglishSpelling(kanaToRomaji(normalizeText(text))));
}
