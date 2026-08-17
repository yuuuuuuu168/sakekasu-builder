// PreToolUse フックの判定本体。scripts/deny-aws-writes.sh から呼ばれる。
// stdin に Claude Code のフック入力 JSON を受け取り、拒否するときだけ
// permissionDecision: "deny" を stdout に出す（何も出さなければ通常の権限フロー）。
//
// 方式は許可リスト。読み取り操作だけを通し、それ以外の AWS CLI 操作は拒否する。
// 拒否リストだと invoke / assume-role / run-instances のように動詞が read でも
// write でもない操作を数え漏らすため。
//
// これはうっかり変更操作を打つのを止めるための関門であって、サンドボックスではない。
// コマンド文字列を読むだけなので、引用符の内側に隠した呼び出し（bash -c で渡すなど）、
// 変数展開、base64、SDK 経由の操作までは見えない。本当の境界は verify プロファイルが
// 参照する読み取り専用の Permission Set にあり、こちらはその手前の網。

// 値を取る AWS CLI のグローバルオプション。サービス名の手前で読み飛ばす
const FLAGS_WITH_VALUE = new Set([
  '--profile', '--region', '--output', '--endpoint-url', '--query', '--color',
  '--ca-bundle', '--cli-read-timeout', '--cli-connect-timeout', '--cli-binary-format',
]);

// 読み取り操作の接頭辞
const READ_PREFIXES = [
  'get-', 'list-', 'describe-', 'batch-get-', 'head-', 'lookup-',
  'search-', 'select-', 'filter-', 'check-', 'validate-', 'simulate-', 'estimate-',
];

// 接頭辞では拾えない読み取り操作。
// 読み取りそうな名前でも実質は違うものがあるため、載せる前に実際の権限を確認する。
// 例えば ecs execute-command はコンテナ内でコマンドを実行するので、ここには載せない。
const READ_EXACT = new Set([
  'sso login', 'sso logout',
  'configure list', 'configure list-profiles', 'configure get',
  // logs tail は高レベルコマンドで、内部は FilterLogEvents（--follow なら StartLiveTail）
  'logs tail',
  'logs start-query', 'logs stop-query', 'logs start-live-tail',
  'dynamodb scan', 'dynamodb query',
  's3 ls',
]);

// シェルの区切り文字。引用符の外にあるときだけ区切りとして扱う
const SEPARATORS = ['&&', '||', ';', '|', '&', '>', '<', '(', ')', '`'];
const SEPARATOR_CHARS = ';|&<>()`';

// ANSI-C 引用（$'…'）の中の打ち消しを実際の文字に戻す。bash はここで \x61 の
// ような表記を解釈するため、字面のまま読むとコマンド名を見落とす
const ANSI_C_ESCAPES = {
  a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n',
  r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?',
};

function decodeAnsiC(body) {
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== '\\' || i + 1 >= body.length) { out += body[i]; continue; }
    i += 1;
    const c = body[i];
    if (c in ANSI_C_ESCAPES) { out += ANSI_C_ESCAPES[c]; continue; }
    // \xHH / \uHHHH / \UHHHHHHHH と、8 進の \nnn
    const digits = (pattern) => (body.slice(i + 1).match(pattern) ?? [''])[0];
    const radix16 = { x: 2, u: 4, U: 8 }[c];
    if (radix16) {
      const h = digits(new RegExp(`^[0-9a-fA-F]{1,${radix16}}`));
      if (h) { out += String.fromCodePoint(parseInt(h, 16)); i += h.length; continue; }
    }
    if (c >= '0' && c <= '7') {
      const o = (body.slice(i).match(/^[0-7]{1,3}/) ?? [''])[0];
      out += String.fromCharCode(parseInt(o, 8));
      i += o.length - 1;
      continue;
    }
    out += c;
  }
  return out;
}

// コマンド文字列をシェルに近い形で語に分ける。字面をそのまま切っていたときに
// 見落としていた形が、レビューで順に挙がった。
//
//   1. 区切り文字が空白で挟まれていないと直前の引数と融合する（/my-group;aws …）
//   2. 語の途中の引用符を落とさないと、シェルが語結合で組み立てる名前を別物として
//      読む。bash は ""s3api も s""3api も s3api という 1 語にする
//   3. 引用や打ち消しでコマンド名そのものを隠せる。$'\x61\x77\x73' も $"aws" も
//      bash では aws になり、\ と改行は行継続として消える
//
// どれもシェルの語の作り方を写していないことが原因なので、引用と打ち消しを
// 解いてから語をつなぐ。区切りは引用の外でだけ切る
function tokenize(command) {
  const tokens = [];
  // 組み立て中の語。「まだ始まっていない」と「空の語」を区別するため null 始まり
  let word = null;
  // 二重引用符の内側か。$"…" もロケール変換が働かない限り同じ扱いになる
  let inDoubleQuote = false;
  const add = (s) => { word = (word ?? '') + s; };
  const flush = () => { if (word !== null) tokens.push(word); word = null; };
  const openDoubleQuote = () => { inDoubleQuote = true; word = word ?? ''; };

  for (let i = 0; i < command.length; i += 1) {
    const c = command[i];

    if (inDoubleQuote) {
      if (c === '"') { inDoubleQuote = false; continue; }
      // 二重引用符の中でもコマンド置換は効く。区切りとして切り出し、以降は
      // 引用の外と同じように読む。閉じ引用符まで戻さないので切りすぎる側に
      // 倒れるが、見落とす側には倒れない
      if (c === '`') { flush(); tokens.push('`'); inDoubleQuote = false; continue; }
      if (c === '$' && command[i + 1] === '(') {
        flush();
        tokens.push('(');
        inDoubleQuote = false;
        i += 1;
        continue;
      }
      if (c === '\\' && i + 1 < command.length) { i += 1; add(command[i]); continue; }
      add(c);
      continue;
    }

    if (c === '\\' && command[i + 1] === '\n') { i += 1; continue; } // 行継続。両方消える
    if (c === '\\' && i + 1 < command.length) { add(command[i + 1]); i += 1; continue; }

    if (c === '$' && command[i + 1] === "'") {
      let body = '';
      let j = i + 2;
      for (; j < command.length && command[j] !== "'"; j += 1) {
        if (command[j] === '\\' && j + 1 < command.length) {
          body += command[j] + command[j + 1];
          j += 1;
          continue;
        }
        body += command[j];
      }
      add(decodeAnsiC(body));
      i = j;
      continue;
    }
    if (c === '$' && command[i + 1] === '"') { openDoubleQuote(); i += 1; continue; }
    if (c === '"') { openDoubleQuote(); continue; }

    if (c === "'") {
      // シングルクォートの中に打ち消しは無い。閉じないまま終わったら残り全部が 1 語
      const end = command.indexOf("'", i + 1);
      add(end === -1 ? command.slice(i + 1) : command.slice(i + 1, end));
      i = end === -1 ? command.length : end;
      continue;
    }

    if (/\s/.test(c)) { flush(); continue; }

    const two = command.slice(i, i + 2);
    if (two === '&&' || two === '||') { flush(); tokens.push(two); i += 1; continue; }
    if (SEPARATOR_CHARS.includes(c)) { flush(); tokens.push(c); continue; }

    add(c);
  }
  flush();
  return tokens;
}

// 実際の AWS CLI のサービス名・操作名は英小文字・数字・ハイフンでできている。
// この形から外れるものは CLI 呼び出しではないと見なす。日本語の散文に混じった
// aws（コミットメッセージなど）や、/usr/local/bin/aws を引数に取る rm を
// 呼び出しと誤認しないため。どちらも実際に誤検知した
const CLI_NAME = /^[a-z0-9][a-z0-9-]*$/;

// tokens[i] が 'aws' のとき、そこから service と operation を読み取る
function parseInvocation(tokens, i) {
  const words = [];
  let j = i + 1;
  while (j < tokens.length && words.length < 2) {
    const t = tokens[j];
    if (t === '--version' || t === 'help') return { service: t, operation: '', safe: true };
    if (t.startsWith('-')) {
      if (FLAGS_WITH_VALUE.has(t) && j + 1 < tokens.length) j += 1;
      j += 1;
      continue;
    }
    // シェルの区切りに当たったら、その aws 呼び出しはそこで終わり
    if (SEPARATORS.includes(t)) break;
    // 空の語は読み飛ばす。bash は空文字を引数として渡すが、サービス名の位置に
    // 空が来た時点でその呼び出しは成立しないので、後ろの語で判定する
    if (t === '') { j += 1; continue; }
    words.push(t);
    j += 1;
  }
  if (words.length === 0) return { service: '', operation: '', safe: true };
  // 変数展開が絡む語は何に化けるか読めないので、呼び出しとして拒否側に倒す
  if (words[0].includes('$')) return { service: words[0], operation: '', safe: false };
  // サービス名が CLI の形をしていなければ、そもそも呼び出しではない
  if (!CLI_NAME.test(words[0])) return { service: '', operation: '', safe: true };
  // 操作名が形から外れる場合は空にする。空は isRead が false を返すので拒否側に倒れる
  const operation = words[1] ?? '';
  return {
    service: words[0],
    operation: CLI_NAME.test(operation) ? operation : '',
    safe: false,
  };
}

function isRead(service, operation) {
  if (!operation) return false;
  if (READ_EXACT.has(`${service} ${operation}`)) return true;
  // s3 の高レベルコマンドは cp / mv / rm / sync / mb / rb が書き込みなので
  // 上の READ_EXACT に載せた ls だけを通す
  if (service === 's3') return false;
  if (operation === 'wait' || operation === 'help') return true;
  return READ_PREFIXES.some((p) => operation.startsWith(p));
}

function findDenied(command) {
  const tokens = tokenize(command);
  for (let i = 0; i < tokens.length; i += 1) {
    // 'aws' 単体、または 'aws' で終わるパス（/usr/local/bin/aws）を CLI 呼び出しとみなす
    if (tokens[i] !== 'aws' && !tokens[i].endsWith('/aws')) continue;
    const { service, operation, safe } = parseInvocation(tokens, i);
    if (safe || !service) continue;
    if (!isRead(service, operation)) {
      return `aws ${service} ${operation}`.trim();
    }
  }
  return null;
}

// 判定は常に走らせる。「直接実行されたときだけ動かす」形にすると、実行パスに
// シンボリックリンクが挟まったときに判定ごと素通りする（argv[1] は解決されず、
// import.meta.url は解決済みなので一致しない）。テストは import ではなく
// このスクリプトを子プロセスとして起動する形にしてある
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let command = '';
  try {
    command = JSON.parse(raw)?.tool_input?.command ?? '';
  } catch {
    // 入力を解釈できないときは判定しない（通常の権限フローに任せる）
    process.exit(0);
  }

  const denied = findDenied(command);
  if (!denied) process.exit(0);

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `クラウドセッションからの AWS 変更操作は禁止されています（検出: ${denied}）。` +
        'verify プロファイルは読み取り専用です。変更が必要な場合は人間に依頼してください。',
    },
  }));
  process.exit(0);
});
