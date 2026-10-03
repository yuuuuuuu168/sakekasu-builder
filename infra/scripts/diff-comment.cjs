/**
 * cdk-diff ワークフローが PR へ投稿するコメントの本文を組む。
 *
 * ワークフローの `github-script` から require される。infra/package.json は
 * type: module なので、CommonJS で読めるよう拡張子を .cjs にしてある。
 *
 * ここを切り出したのは、扱う入力が信頼できないため。`cdkd diff` の出力には
 * PR 側が決められる値（コンストラクト ID、プロパティ、タグ）が入る。この
 * 組み立ては aws-security-agent の指摘を2回受けていて（PR #230）、どちらも
 * 「本文に何を仕込まれても壊れないか」という性質の話だった。インラインの
 * JavaScript では試せないので、単体で試せる場所へ出した。
 */

/** GitHub のコメント本文の上限 */
const COMMENT_LIMIT = 65536;

/**
 * 囲みのバッククォートの上限。
 *
 * 上限を置かないと、長いバッククォート列を仕込まれたときに囲みも同じだけ
 * 伸び、コメント全体が上限を超えて投稿が 422 で落ちる。つまり差分コメントを
 * 消せる。上限を超える連続のほうをゼロ幅スペースで切る。
 */
const FENCE_MAX = 16;

/** ANSI のエスケープシーケンス。正規表現に制御文字を直書きしない形で組む */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** バッククォートの最長連続の長さ */
function longestBacktickRun(text) {
  return (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
}

/**
 * 本文を囲む「```」を決める。
 *
 * 本文中の最長連続より1つ長くすることで、本文を書き換えずに囲みを途中で
 * 閉じられなくする。`FENCE_MAX` で頭を抑えるため、呼ぶ側は先に
 * {@link breakLongBacktickRuns} を通しておく必要がある。
 */
function fenceFor(text) {
  return '`'.repeat(Math.min(FENCE_MAX, Math.max(3, longestBacktickRun(text) + 1)));
}

/**
 * 囲みの上限を超えるバッククォートの連続を、ゼロ幅スペースで切る。
 *
 * ここに来るのは仕込み以外に無い。普通の差分出力にバッククォートが16個
 * 続くことはない。
 */
function breakLongBacktickRuns(text) {
  return text.replace(new RegExp(`\`{${FENCE_MAX},}`, 'g'), (run) => [...run].join('​'));
}

/**
 * 投稿する本文を組む。
 *
 * 順番に意味がある。連続を切るのは切り詰めより先（ゼロ幅スペースで伸びた分を
 * 切り詰めが吸収する）。囲みを決めるのは切り詰めより後（切り詰めで連続が
 * 短くなることがある）。
 *
 * @param {object} options
 * @param {string} options.raw `cdkd diff` の生の出力
 * @param {string} options.marker 既存コメントを見つけるための目印
 * @param {string} [options.heading] 見出し
 * @param {number} [options.limit] 本文の切り詰め先（既定 60000）
 * @returns {string} 投稿する本文。必ず COMMENT_LIMIT 以下になる
 */
function buildComment({ raw, marker, heading = '## cdkd diff', limit = 60000 }) {
  // cdkd は --no-color も NO_COLOR も持たず、TTY でなくてもエラー出力には
  // 色を付ける。コメントにエスケープシーケンスが混ざるので落とす
  let body = raw.replace(ANSI, '');

  body = breakLongBacktickRuns(body);

  if (body.length > limit) {
    body = `${body.slice(0, limit)}\n...（長すぎるため省略。全文は Actions のログを参照）`;
  }

  const fence = fenceFor(body);
  const full = `${marker}\n${heading}\n\n${fence}\n${body}\n${fence}`;

  if (full.length > COMMENT_LIMIT) {
    // ここに来るのは limit の指定が大きすぎるとき。黙って 422 を食らうより
    // 組み立て側で気づけるようにする
    throw new Error(
      `コメント本文が GitHub の上限を超えた: ${full.length} > ${COMMENT_LIMIT}（limit=${limit}）`,
    );
  }

  return full;
}

module.exports = {
  COMMENT_LIMIT,
  FENCE_MAX,
  buildComment,
  fenceFor,
  breakLongBacktickRuns,
  longestBacktickRun,
};
