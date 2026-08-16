// PreToolUse フックの判定本体。scripts/deny-aws-writes.sh から呼ばれる。
// stdin に Claude Code のフック入力 JSON を受け取り、拒否するときだけ
// permissionDecision: "deny" を stdout に出す（何も出さなければ通常の権限フロー）。
//
// 方式は許可リスト。読み取り操作だけを通し、それ以外の AWS CLI 操作は拒否する。
// 拒否リストだと invoke / assume-role / run-instances のように動詞が read でも
// write でもない操作を数え漏らすため。

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

// 接頭辞では拾えない読み取り操作
const READ_EXACT = new Set([
  'sso login', 'sso logout',
  'configure list', 'configure list-profiles', 'configure get',
  'logs start-query', 'logs stop-query', 'logs start-live-tail',
  'dynamodb scan', 'dynamodb query',
  's3 ls',
]);

function tokenize(command) {
  const tokens = [];
  const re = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+/g;
  let m;
  while ((m = re.exec(command)) !== null) tokens.push(m[0]);
  return tokens;
}

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
    if (['&&', '||', ';', '|', '>', '<'].includes(t)) break;
    words.push(t);
    j += 1;
  }
  if (words.length === 0) return { service: '', operation: '', safe: true };
  return { service: words[0], operation: words[1] ?? '', safe: false };
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
