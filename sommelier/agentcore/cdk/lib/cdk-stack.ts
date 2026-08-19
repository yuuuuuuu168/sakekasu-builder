import {
  AgentCoreApplication,
  AgentCoreMcp,
  type AgentCoreProjectSpec,
  type AgentCoreMcpSpec,
} from '@aws/agentcore-cdk';
import { ArnFormat, CfnOutput, Stack, aws_iam as iam, type StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

/** エージェントに渡すテーブル名の環境変数名（読み取り権限を付与する対象） */
const TABLE_ENV_NAMES = ['PURCHASE_TABLE_NAME', 'DRINKING_TABLE_NAME'] as const;

/** エージェントが参照する各テーブルの GSI 名（main.py と一致させる） */
const OWNER_INDEX_NAME = 'owner-index';

/** DynamoDB のテーブル名として許可する形式（ワイルドカードや区切り文字を弾く） */
const DYNAMODB_TABLE_NAME_PATTERN = /^[a-zA-Z0-9_.-]{3,255}$/;

/**
 * Web 検索の API キーを入れた Secrets Manager のシークレット名を渡す環境変数名。
 * テーブル名と同じく agentcore.json を唯一の定義元とし、ここでは読むだけにする。
 *
 * 未設定なら権限も付けない。エージェント側もこの環境変数が無ければ検索を
 * 無効にして動くので、「キーを登録していない環境」はそのまま検索なしで動く。
 */
const SEARCH_API_KEY_SECRET_ENV_NAME = 'TAVILY_API_KEY_SECRET_ID';

/**
 * Secrets Manager のシークレット名として許可する形式。
 * サービスが許すのは英数字と /_+=.@- で、ワイルドカードは含まれない。
 * ARN を文字列連結で組み立てる以上、`*` を仕込まれると権限が広がるため
 * ここで弾く（テーブル名と同じ理由）。
 */
const SECRET_NAME_PATTERN = /^[a-zA-Z0-9/_+=.@-]{1,512}$/;

export interface AgentCoreStackProps extends StackProps {
  /**
   * The AgentCore project specification containing agents, memories, and credentials.
   */
  spec: AgentCoreProjectSpec;
  /**
   * The MCP specification containing gateways and servers.
   */
  mcpSpec?: AgentCoreMcpSpec;
  /**
   * Credential provider ARNs from deployed state, keyed by credential name.
   */
  credentials?: Record<string, { credentialProviderArn: string; clientSecretArn?: string }>;
}

/**
 * CDK Stack that deploys AgentCore infrastructure.
 *
 * This is a thin wrapper that instantiates L3 constructs.
 * All resource logic and outputs are contained within the L3 constructs.
 */
export class AgentCoreStack extends Stack {
  /** The AgentCore application containing all agent environments */
  public readonly application: AgentCoreApplication;

  constructor(scope: Construct, id: string, props: AgentCoreStackProps) {
    super(scope, id, props);

    const { spec, mcpSpec, credentials } = props;

    // Create AgentCoreApplication with all agents
    this.application = new AgentCoreApplication(this, 'Application', {
      spec,
    });

    // Create AgentCoreMcp if there are gateways configured
    if (mcpSpec?.agentCoreGateways && mcpSpec.agentCoreGateways.length > 0) {
      new AgentCoreMcp(this, 'Mcp', {
        projectName: spec.name,
        mcpSpec,
        agentCoreApplication: this.application,
        credentials,
        projectTags: spec.tags,
      });
    }

    // エージェントの記録取得 Tool（購入記録・飲酒記録）用に DynamoDB の
    // 読み取り権限を付与する。
    // Bedrock の呼び出し権限は L3 コンストラクトが自動で付けるが、
    // アプリ固有のデータソースへの権限はここで明示的に与える必要がある。
    //
    // テーブル名は agentcore.json の envVars を唯一の定義元とし、ここでは
    // それを読み取る。CDK 側に別途ハードコードすると、環境ごとに値を変えた
    // ときに権限とエージェントの参照先がずれる（設定ドリフト）ため。
    for (const agent of spec.runtimes ?? []) {
      const environment = this.application.environments.get(agent.name);
      // 権限を付けられないまま進むと、権限不足のエージェントが黙って
      // デプロイされる。設定ミスは synth 時に落とす（フェイルクローズ）
      if (!environment) {
        throw new Error(`エージェント "${agent.name}" の環境が見つからないため権限を付与できません`);
      }

      for (const tableEnvName of TABLE_ENV_NAMES) {
        const tableName = agent.envVars?.find(v => v.name === tableEnvName)?.value;
        if (!tableName) {
          throw new Error(`エージェント "${agent.name}" に ${tableEnvName} が設定されていません`);
        }
        // formatArn は文字列連結なので、設定ファイルの値をそのまま渡すと
        // "*" や "/" を仕込まれた場合に権限が意図せず広がる。
        // DynamoDB のテーブル名として妥当な文字だけを許可する
        if (!DYNAMODB_TABLE_NAME_PATTERN.test(tableName)) {
          throw new Error(
            `${tableEnvName} の値が不正です: "${tableName}"（使用できるのは英数字と _ . - の3〜255文字）`
          );
        }

        const tableArn = Stack.of(this).formatArn({
          service: 'dynamodb',
          resource: 'table',
          resourceName: tableName,
        });
        environment.runtime.role.addToPrincipalPolicy(
          new iam.PolicyStatement({
            actions: ['dynamodb:Query', 'dynamodb:GetItem'],
            // GSI 経由で読むためインデックスも対象にするが、実際に使う
            // owner-index だけに限定する（今後 GSI が増えても自動で広がらない）
            resources: [tableArn, `${tableArn}/index/${OWNER_INDEX_NAME}`],
          })
        );
      }

      // Web 検索の API キーはリポジトリにも agentcore.json にも置かず、
      // Secrets Manager に手で登録しておく。エージェントへ渡すのは名前だけで、
      // 値を読む権限をここで（そのシークレット1つに限って）与える。
      const secretName = agent.envVars?.find(
        v => v.name === SEARCH_API_KEY_SECRET_ENV_NAME
      )?.value;
      if (secretName) {
        if (!SECRET_NAME_PATTERN.test(secretName)) {
          throw new Error(
            `${SEARCH_API_KEY_SECRET_ENV_NAME} の値が不正です: "${secretName}"（使用できるのは英数字と /_+=.@- の1〜512文字）`
          );
        }
        environment.runtime.role.addToPrincipalPolicy(
          new iam.PolicyStatement({
            actions: ['secretsmanager:GetSecretValue'],
            // Secrets Manager は ARN の末尾に6文字のランダムな接尾辞を付ける。
            // 名前だけでは ARN が確定しないため、既存スタックと同じく `-*` で受ける
            resources: [
              Stack.of(this).formatArn({
                service: 'secretsmanager',
                resource: 'secret',
                resourceName: `${secretName}-*`,
                arnFormat: ArnFormat.COLON_RESOURCE_NAME,
              }),
            ],
          })
        );
      }
    }

    // Stack-level output
    new CfnOutput(this, 'StackNameOutput', {
      description: 'Name of the CloudFormation Stack',
      value: this.stackName,
    });
  }
}
