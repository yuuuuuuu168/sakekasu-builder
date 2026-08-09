import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as fs from 'fs';
import * as path from 'path';
import type { AgentCoreProjectSpec } from '@aws/agentcore-cdk';
import { AgentCoreStack } from '../lib/cdk-stack';

/** 実際にデプロイする設定そのものを読む（テスト用に書き写すと本物とずれる） */
function readProjectSpec(): AgentCoreProjectSpec {
  const configPath = path.join(__dirname, '..', '..', 'agentcore.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf8')) as AgentCoreProjectSpec;
}

/**
 * 実設定の synth 結果。CodeZip の梱包を伴って数十秒かかるため、
 * テストごとに作り直さず一度だけ組み立てて使い回す。
 */
let projectTemplate: Template | undefined;

function synthesizeProject(): Template {
  if (!projectTemplate) {
    const app = new cdk.App();
    const stack = new AgentCoreStack(app, 'AgentCore-sommelier-dev', {
      spec: readProjectSpec(),
    });
    projectTemplate = Template.fromStack(stack);
  }
  return projectTemplate;
}

test('AgentCoreStack synthesizes with empty spec', () => {
  const app = new cdk.App();
  const stack = new AgentCoreStack(app, 'TestStack', {
    spec: {
      name: 'testproject',
      version: 1,
      managedBy: 'CDK' as const,
      runtimes: [],
      memories: [],
      credentials: [],
      evaluators: [],
      onlineEvalConfigs: [],
      policyEngines: [],
      agentCoreGateways: [],
      mcpRuntimeTools: [],
      unassignedTargets: [],
    },
  });
  const template = Template.fromStack(stack);
  template.hasOutput('StackNameOutput', {
    Description: 'Name of the CloudFormation Stack',
  });
});

// 好み学習（Issue #51）は「記憶が作られる」「エージェントがその ID を
// 受け取れる」「読み書きの権限がある」の3つが揃って初めて動く。
// どれか1つでも欠けると、エージェントは黙って記憶なしのまま動き続ける
// （フェイルオープン設計なので実行時エラーにならない）ため synth で確かめる。
describe('好み学習用の AgentCore Memory', () => {
  test('USER_PREFERENCE の記憶をユーザー単位の名前空間で作る', () => {
    synthesizeProject().hasResourceProperties('AWS::BedrockAgentCore::Memory', {
      MemoryStrategies: [
        {
          UserPreferenceMemoryStrategy: Match.objectLike({
            // main.py 側の PREFERENCE_NAMESPACE_TEMPLATE と一致させること。
            // ずれると書き込みと読み出しが別の棚を指し、好みが引けなくなる
            Namespaces: ['sommelier/preference/{actorId}'],
          }),
        },
      ],
    });
  });

  test('記憶 ID をエージェントの環境変数として渡す', () => {
    synthesizeProject().hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
      EnvironmentVariables: Match.objectLike({
        // preference_memory.py の MEMORY_ID_ENV_NAME と一致させること
        MEMORY_PREFERENCE_ID: Match.anyValue(),
      }),
    });
  });

  test('エージェントに記憶の読み書き権限を与える', () => {
    synthesizeProject().hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          // 読み出しは名前空間の条件つき（他ユーザーの棚を引けない）
          Match.objectLike({
            Action: Match.arrayWith(['bedrock-agentcore:RetrieveMemoryRecords']),
            Condition: {
              StringLike: {
                'bedrock-agentcore:namespace': ['sommelier/preference/*'],
              },
            },
          }),
          Match.objectLike({
            Action: Match.arrayWith(['bedrock-agentcore:CreateEvent']),
          }),
        ]),
      },
    });
  });
});
