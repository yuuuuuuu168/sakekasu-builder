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

import { pathToFileURL } from 'node:url';

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

// シェルの区切り文字。空白で挟まれていなくても独立したトークンに切る
const SEPARATORS = ['&&', '||', ';', '|', '&', '>', '<', '(', ')', '`'];

// 引用符の中は 1 つのトークンとして扱う。区切り文字まで切っているのは、\S+ だけで
// 分けると「読み取りコマンドの引数末尾にセミコロンを付けて次の呼び出しを続ける」形
// （/my-group;aws … ）でセミコロンが直前の引数と融合し、2 つ目の呼び出しを
// 見落とすため。区切りが独立トークンになれば parseInvocation がそこで打ち切る
function tokenize(command) {
  const tokens = [];
  const re = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|&&|\|\||[;|&<>()`]|[^\s;|&<>()`]+/g;
  let m;
  while ((m = re.exec(command)) !== null) tokens.push(m[0]);
  return tokens;
}

// 引用符ごしに書かれても実行時には外れる（"s3" は s3 になる）ので、
// サービス名・操作名を見る前に外す
function unquote(token) {
  const q = token[0];
  if ((q === '"' || q === "'") && token.length >= 2 && token.endsWith(q)) {
    return token.slice(1, -1);
  }
  return token;
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
    words.push(unquote(t));
    j += 1;
  }
  if (words.length === 0) return { service: '', operation: '', safe: true };
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

export function findDenied(command) {
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

function main() {
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
}

// フックとして呼ばれたときだけ stdin を読む。テストから import したときに
// 標準入力待ちで固まらないようにするため
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
