import { RetentionDays } from 'aws-cdk-lib/aws-logs';

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
 *
 * **設定には非推奨の `logRetention` プロパティを使っている。** 現行の推奨は
 * `logGroup` に `logs.LogGroup` を渡す形だが、そちらへ移すと
 * **ロググループ名が CDK 生成名に変わる**（型定義にも
 * "Migrating from `logRetention` to `logGroup` will cause the name of the log
 * group to change." と明記）。`/aws/lambda/<関数名>` でなくなると運用手順と
 * docs/ の調査コマンドが全部変わり、過去のログも旧グループに取り残される。
 * 既存名を明示指定すると、今度は CloudFormation が既存グループの作成を試みて
 * `AlreadyExists` で落ちる。移行の損が上回るため、承知の上で非推奨側を使う。
 */
export const LAMBDA_LOG_RETENTION = RetentionDays.ONE_MONTH;
