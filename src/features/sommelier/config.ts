/**
 * デプロイ済み AgentCore Runtime の接続先。
 *
 * 値は `sommelier/agentcore/.cli/deployed-state.json` に対応する。
 * Runtime を作り直した場合はここも更新する。
 * ARN は秘密情報ではない（呼び出しには Cognito の JWT が必須）ため、
 * amplify_outputs.json と同様にコミットしている。
 * 環境ごとに変えたい場合は VITE_SOMMELIER_RUNTIME_ARN で上書きできる。
 */
export const SOMMELIER_RUNTIME_ARN =
  import.meta.env.VITE_SOMMELIER_RUNTIME_ARN ??
  'arn:aws:bedrock-agentcore:ap-northeast-1:232791540685:runtime/sommelier_sommelier-Cn5eM865GE';

/** Runtime のリージョン（ARN から導出できるが、明示して読みやすくする） */
export const SOMMELIER_RUNTIME_REGION = 'ap-northeast-1';

/** 呼び出すエンドポイントの修飾子 */
export const SOMMELIER_RUNTIME_QUALIFIER = 'DEFAULT';
