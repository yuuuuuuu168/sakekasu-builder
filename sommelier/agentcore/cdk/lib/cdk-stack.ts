import {
  AgentCoreApplication,
  AgentCoreMcp,
  type AgentCoreProjectSpec,
  type AgentCoreMcpSpec,
} from '@aws/agentcore-cdk';
import { CfnOutput, Stack, aws_iam as iam, type StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

/**
 * エージェントが参照する購入記録テーブル。
 * agentcore.json の envVars（PURCHASE_TABLE_NAME）と揃える必要がある。
 */
const PURCHASE_TABLE_NAME = 'dev-sakekasu-purchase-records';

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

    // エージェントの購入記録取得 Tool 用に DynamoDB の読み取り権限を付与する。
    // Bedrock の呼び出し権限は L3 コンストラクトが自動で付けるが、
    // アプリ固有のデータソースへの権限はここで明示的に与える必要がある。
    const tableArn = Stack.of(this).formatArn({
      service: 'dynamodb',
      resource: 'table',
      resourceName: PURCHASE_TABLE_NAME,
    });
    const readPurchaseRecords = new iam.PolicyStatement({
      actions: ['dynamodb:Query', 'dynamodb:GetItem'],
      // GSI（owner-index）を使うためインデックスの ARN も対象に含める
      resources: [tableArn, `${tableArn}/index/*`],
    });
    for (const environment of this.application.environments.values()) {
      environment.runtime.role.addToPrincipalPolicy(readPurchaseRecords);
    }

    // Stack-level output
    new CfnOutput(this, 'StackNameOutput', {
      description: 'Name of the CloudFormation Stack',
      value: this.stackName,
    });
  }
}
