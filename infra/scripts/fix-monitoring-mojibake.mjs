#!/usr/bin/env node
/**
 * 監視スタックの文字化けを Cloud Control で直す（一回限りの修復）。
 *
 * CloudFormation が非ASCII を `?` に置き換えていた。テンプレートどおりに入れた
 * つもりのアラームの説明文や SNS の表示名が、実物では全部 `?` になっている。
 * `cdk diff` はテンプレート同士しか比べないため、CloudFormation 時代は誰も
 * 気づけなかった。cdkd へ移して実物と比べる手立てができて初めて見えた。
 *
 * **cdkd では直せない。**
 *
 * - `cdkd deploy` が比べるのはテンプレートと state。state は正しい日本語を
 *   持っているので差分が無く、何もしない
 * - `cdkd drift --revert` は state と実物を比べる経路だが、0.291.31 は
 *   CloudWatch Alarm / SNS Topic / Events Rule / SLO の差分を検出しない
 *   （より古い版では検出できていた）。差が無いことになるので動かない
 *
 * そこで Cloud Control に直接パッチを当てる。説明文のパスだけを `replace` する
 * ので、他の項目・アラームの履歴・SNS の購読には触らない。
 *
 * 直す値は合成結果（`cdk.out`）から引く。スクリプトに文面を写し取ると
 * `lib/monitoring-stack.ts` と二重管理になり、片方だけ直して食い違う。
 *
 * 使い方（`infra/` で実行する）:
 *
 *   npx cdk synth sakekasu-dev-monitoring -c env=dev
 *   AWS_PROFILE=sakekasu-builder node scripts/fix-monitoring-mojibake.mjs --dry-run
 *   AWS_PROFILE=sakekasu-builder node scripts/fix-monitoring-mojibake.mjs
 *
 * 冪等。すでに一致しているものは飛ばす。cdkd のデプロイロールではなく人間の
 * 資格情報で動かす（`sakekasu-cdkd-deploy` は CI 専用で人は入れない）。
 *
 * cdkd 側が drift を検出できるようになったら、この修復は
 * `cdkd drift <スタック> --revert` で済むのでこのファイルは消してよい。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * 型ごとの「物理名のプロパティ」と「直す文字列のプロパティ」。
 *
 * Cloud Control の識別子は型ごとに違う（レジストリの primaryIdentifier）。
 * Alarm は AlarmName がそのまま識別子だが、Topic は TopicArn、Rule は Arn で、
 * どちらもテンプレートには無いので実物から引く必要がある。SLO は Arn が
 * 識別子だが、Name を渡しても GetResource が通る。
 */
export const TEXT_FIELDS = {
  'AWS::CloudWatch::Alarm': { nameKey: 'AlarmName', textKey: 'AlarmDescription', lookup: false },
  'AWS::SNS::Topic': { nameKey: 'TopicName', textKey: 'DisplayName', lookup: true },
  'AWS::Events::Rule': { nameKey: 'Name', textKey: 'Description', lookup: true },
  'AWS::ApplicationSignals::ServiceLevelObjective': {
    nameKey: 'Name',
    textKey: 'Description',
    lookup: false,
  },
};

/**
 * 直す対象をテンプレートから集める。
 *
 * ASCII だけの文面は CloudFormation に壊されようがないので外す。残すのは
 * 非ASCII を含むものだけ。物理名が `Fn::` などで解決できないものは、識別子を
 * 組み立てられないので対象にしない（呼ぶ側が気づけるよう skipped に入れる）。
 */
export function collectTargets(template) {
  const targets = [];
  const skipped = [];

  for (const [logicalId, resource] of Object.entries(template.Resources ?? {})) {
    const field = TEXT_FIELDS[resource.Type];
    if (!field) continue;

    const properties = resource.Properties ?? {};
    const text = properties[field.textKey];
    if (typeof text !== 'string' || isAsciiOnly(text)) continue;

    const name = properties[field.nameKey];
    if (typeof name !== 'string') {
      skipped.push({ logicalId, type: resource.Type, reason: `${field.nameKey} が文字列でない` });
      continue;
    }

    targets.push({ logicalId, type: resource.Type, name, textKey: field.textKey, text });
  }

  return { targets, skipped };
}

/** 非ASCII を含まないか */
export function isAsciiOnly(value) {
  return /^[\u0000-\u007f]*$/.test(value);
}

/**
 * Cloud Control に渡すパッチ。
 *
 * 1プロパティの replace だけ。Cloud Control は実物を読んでからこれを当てるので、
 * 触っていない項目は実物の値がそのまま残る。
 */
export function buildPatch(textKey, text) {
  return [{ op: 'replace', path: `/${textKey}`, value: text }];
}

/** 直す必要があるものだけに絞る */
export function planRepairs(targets, readLive) {
  const plan = [];
  for (const target of targets) {
    const live = readLive(target);
    plan.push({ ...target, live, repaired: live === target.text });
  }
  return plan;
}

const REGION = 'ap-northeast-1';

function aws(args) {
  return execFileSync('aws', ['--region', REGION, ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** Topic と Rule は識別子がテンプレートに無いので実物から引く */
function resolveIdentifier(target) {
  if (target.type === 'AWS::SNS::Topic') {
    const { Topics } = JSON.parse(aws(['sns', 'list-topics', '--output', 'json']));
    const found = Topics.map((t) => t.TopicArn).find(
      (arn) => arn.slice(arn.lastIndexOf(':') + 1) === target.name,
    );
    if (!found) throw new Error(`SNS トピックが見つかりません: ${target.name}`);
    return found;
  }
  if (target.type === 'AWS::Events::Rule') {
    const { Rules } = JSON.parse(
      aws(['events', 'list-rules', '--name-prefix', target.name, '--output', 'json']),
    );
    const found = Rules.find((r) => r.Name === target.name);
    if (!found) throw new Error(`EventBridge のルールが見つかりません: ${target.name}`);
    return found.Arn;
  }
  return target.name;
}

function readLiveValue(target) {
  const identifier = resolveIdentifier(target);
  const described = JSON.parse(
    aws([
      'cloudcontrol',
      'get-resource',
      '--type-name',
      target.type,
      '--identifier',
      identifier,
      '--output',
      'json',
    ]),
  );
  const properties = JSON.parse(described.ResourceDescription.Properties);
  return { identifier, value: properties[target.textKey] ?? null };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const dryRun = process.argv.includes('--dry-run');
  const templatePath = 'cdk.out/sakekasu-dev-monitoring.template.json';

  let template;
  try {
    template = JSON.parse(readFileSync(templatePath, 'utf8'));
  } catch {
    console.error(
      `::error::${templatePath} が読めません。先に npx cdk synth sakekasu-dev-monitoring -c env=dev を実行してください`,
    );
    process.exit(1);
  }

  const { targets, skipped } = collectTargets(template);
  for (const { logicalId, type, reason } of skipped) {
    console.warn(`::warning::${logicalId} (${type}) を対象から外しました: ${reason}`);
  }

  let same = 0;
  let fixed = 0;
  let failed = 0;

  for (const target of targets) {
    let identifier;
    let live;
    try {
      ({ identifier, value: live } = readLiveValue(target));
    } catch (error) {
      console.error(`  ✗ 読めない ${target.name}: ${error instanceof Error ? error.message : error}`);
      failed += 1;
      continue;
    }

    if (live === target.text) {
      console.log(`  一致   ${target.name}`);
      same += 1;
      continue;
    }

    if (dryRun) {
      console.log(`  直す   ${target.name}`);
      console.log(`    ${live}`);
      console.log(`    -> ${target.text}`);
      fixed += 1;
      continue;
    }

    try {
      aws([
        'cloudcontrol',
        'update-resource',
        '--type-name',
        target.type,
        '--identifier',
        identifier,
        '--patch-document',
        JSON.stringify(buildPatch(target.textKey, target.text)),
      ]);
      console.log(`  ✓ 直した ${target.name}`);
      fixed += 1;
    } catch (error) {
      console.error(`  ✗ 失敗   ${target.name}: ${error instanceof Error ? error.message : error}`);
      failed += 1;
    }
  }

  console.log(
    `\n対象 ${targets.length} 件: 一致 ${same} / ${dryRun ? '直す' : '直した'} ${fixed} / 失敗 ${failed}`,
  );
  if (failed > 0) process.exit(1);
}
