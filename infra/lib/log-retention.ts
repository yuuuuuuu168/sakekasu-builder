import * as cdk from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';

/**
 * Lambda のログ保持期間（Issue #127）。
 *
 * 既定では Lambda のロググループは無期限で残る。本アプリのログには
 * 利用者の Cognito sub が入りうる（画像のキーが `{sub}/...` の形式）ため、
 * 無期限に残し続けない。
 *
 * 30 日にしているのは Application Signals の `aws/spans`（AWS が既定で 30 日を
 * 付ける）に揃えるため。メトリクスフィルター由来の値（`ImageDeleteFailCount`
 * など）は CloudWatch メトリクスとして15か月保持されるので、ログを 30 日で
 * 捨ててもアラームの動作には影響しない。
 */
export const LAMBDA_LOG_RETENTION = logs.RetentionDays.ONE_MONTH;

/**
 * Lambda に渡すロググループを作る（Issue #129）。
 *
 * 以前は `NodejsFunction` の `logRetention` に保持期間を渡していたが、この
 * プロパティは非推奨で CDK v3 では消える。中身も素直ではなく、保持期間を
 * 設定するためだけのカスタムリソース（`Custom::LogRetention`）と、その実体で
 * ある Lambda がスタックごとに増えていた。現行の推奨は、明示的な
 * `logs.LogGroup` を作って `logGroup` に渡す形。
 *
 * ロググループ名は Lambda の既定と同じ `/aws/lambda/<関数名>` を明示する。
 * 名前を CDK の生成名に任せると（型定義にも "Migrating from `logRetention` to
 * `logGroup` will cause the name of the log group to change." と書いてある）、
 * docs/ の調査コマンドと運用手順が全部変わり、過去のログも旧グループに
 * 取り残される。名前を維持することがこの移行の前提。
 *
 * 名前を維持するぶん、既に同名のロググループがあるアカウントでは
 * CloudFormation が `AlreadyExists` で落ちる。既存環境へは `cdk import` で
 * 取り込んでから配線する（手順は docs/log-group-import.md）。
 *
 * `removalPolicy` は `RETAIN`。スタックを消したときにログまで道連れにしない。
 * 保持期間で自然に消える以上、削除まで CloudFormation に任せる理由が無い。
 *
 * @param scope ロググループを置くスタック
 * @param id 構造上の ID。関数の ID に `LogGroup` を足した名前にする
 * @param functionName ロググループ名を組み立てる元。関数の `functionName` と
 *   同じ値を渡すこと（変数に切り出して両方へ渡すのが安全）
 */
export function lambdaLogGroup(
  scope: Construct,
  id: string,
  functionName: string,
): logs.LogGroup {
  return new logs.LogGroup(scope, id, {
    logGroupName: `/aws/lambda/${functionName}`,
    retention: LAMBDA_LOG_RETENTION,
    removalPolicy: cdk.RemovalPolicy.RETAIN,
  });
}
