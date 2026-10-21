import * as path from 'node:path';
import * as url from 'node:url';
import { OutputFormat, type BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';

/**
 * 全スタックの NodejsFunction で揃えている設定。
 *
 * 関数ごとに書き写していたものを 1 か所に寄せた。メモリ・タイムアウト・アーキテクチャは
 * 関数ごとに理由があって値が違うので、ここには置かず呼び出し側に残す。
 */

/**
 * 全 Lambda のランタイム。上げられる上限は Application Signals の対応状況で決まる
 * （__tests__/lambda-config.test.ts の EXPECTED_RUNTIME のコメント）
 */
export const LAMBDA_RUNTIME = Runtime.NODEJS_22_X;

/**
 * ESM でバンドルする。依存の中に CommonJS の `require` を呼ぶものがあっても動くように、
 * バナーで `require` を作っておく。mainFields は ESM の入口（module）を先に見る
 */
export const ESM_BUNDLING: BundlingOptions = {
  format: OutputFormat.ESM,
  mainFields: ['module', 'main'],
  banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
};

const here = path.dirname(url.fileURLToPath(import.meta.url));

/** infra/lambda/<name>/index.ts の絶対パス。NodejsFunction の entry に渡す */
export function lambdaEntry(name: string): string {
  return path.join(here, `../lambda/${name}/index.ts`);
}
