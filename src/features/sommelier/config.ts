/**
 * デプロイ済み AgentCore Runtime の接続先。
 *
 * ビルド時に VITE_SOMMELIER_RUNTIME_ARN で渡す。ARN にはアカウント ID が入るため、
 * 公開リポジトリには書かない（deploy-site.yml が secrets から組み立てる）。
 * 手元で画面からソムリエを使うときは、.env.local に同じ名前で置く。
 * 値は `sommelier/agentcore/.cli/deployed-state.json`（agentcore CLI がローカルに書く）の
 * runtimeArn と同じ。
 */
export const SOMMELIER_RUNTIME_ARN: string = import.meta.env.VITE_SOMMELIER_RUNTIME_ARN ?? '';

/** Runtime のリージョン（ARN から導出できるが、明示して読みやすくする） */
export const SOMMELIER_RUNTIME_REGION = 'ap-northeast-1';

/** 呼び出すエンドポイントの修飾子 */
export const SOMMELIER_RUNTIME_QUALIFIER = 'DEFAULT';
