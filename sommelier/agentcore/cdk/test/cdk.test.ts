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

/**
 * ポリシーが書かれうる場所すべてから Statement を平らに集める。
 *
 * Match.arrayWith / Match.objectLike は「条件に合うものが1つ以上ある」しか見ない。
 * 権限を絞れているかを確かめたいときは「これ以外に無い」まで言えないと意味がないため、
 * 数え上げる側に寄せている。数え上げである以上、見る場所が欠けるとそのまま嘘になるので
 * AWS::IAM::Policy だけでなく管理ポリシーとロール埋め込みも辿る。
 */
function allPolicyStatements(): any[] {
  const template = synthesizeProject();
  const documentsOf = (type: string) =>
    Object.values(template.findResources(type)).flatMap(
      (resource: any) => resource.Properties?.PolicyDocument?.Statement ?? []
    );
  const inlineRoleStatements = Object.values(template.findResources('AWS::IAM::Role'))
    .flatMap((role: any) => role.Properties?.Policies ?? [])
    .flatMap((policy: any) => policy.PolicyDocument?.Statement ?? []);
  return [...documentsOf('AWS::IAM::Policy'), ...documentsOf('AWS::IAM::ManagedPolicy'), ...inlineRoleStatements];
}

/** Statement が許す action を並べる */
function actionsOf(statement: any): string[] {
  // NotAction は「並べたもの以外すべて」なので、実質のワイルドカードとして扱う
  if (statement.NotAction !== undefined) return ['*'];
  if (statement.Action === undefined) return [];
  const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
  // 組み込み関数などで文字列に落ちないものを黙って捨てると、数え上げたつもりで
  // 数え落とすことになる。前提が崩れたと分かるよう素通りさせない
  if (actions.some((action: unknown) => typeof action !== 'string')) {
    throw new Error(`action を文字列として読めません: ${JSON.stringify(statement.Action)}`);
  }
  return actions as string[];
}

/**
 * その許可がその action に届くかを、IAM の照合規則に合わせて見る。
 * IAM のワイルドカードは * と ? の2つで、action 名の大文字小文字は区別しない。
 * 照合を IAM より狭く書くと、届いている許可を数え落として素通りさせてしまう
 */
function grants(granted: string, action: string): boolean {
  const pattern = granted
    .toLowerCase()
    // ワイルドカードの2文字は残し、それ以外の正規表現の特殊文字だけ潰してから展開する
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${pattern}$`).test(action.toLowerCase());
}

/** その action を許可している Statement をすべて拾う（* でまとめて許可しているものも含む） */
function statementsAllowing(action: string): any[] {
  return allPolicyStatements().filter(
    statement => statement.Effect === 'Allow' && actionsOf(statement).some(granted => grants(granted, action))
  );
}

/** 好み記憶の ARN。論理 ID の末尾ハッシュは synth ごとに変わりうるので前方一致で見る */
const PREFERENCE_MEMORY_ARN = {
  'Fn::GetAtt': [expect.stringMatching(/^ApplicationMemoryPreference/), 'MemoryArn'],
};

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
            NamespaceTemplates: ['sommelier/preference/{actorId}'],
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

  // 権限の形は L3 コンストラクト（@aws/agentcore-cdk）が決める。
  // ここで確かめたいのは「与えられているか」だけでなく、
  // どこまで IAM で守られていて、どこからアプリの責任なのかの線引き。
  //
  // 名前空間の条件を付けられるのは、条件キー bedrock-agentcore:namespace を
  // 受け付ける ListMemoryRecords / RetrieveMemoryRecords の2つだけ。
  // CreateEvent は namespace を引数に取らず（名前空間はストラテジ設定と
  // actorId からサービス側が決める）条件キーも持たないため、条件を付けると
  // 常に不一致で全拒否になる。したがって「書き込み先を本人に限る」のは
  // preference_memory.py の actor_id 検証が唯一の砦になる。
  //
  // 経路の数そのものは版で変わる（alpha.45 で条件キー namespacePath が増え、
  // 読み出しが2文に分かれた）。数を決め打ちにすると、増えただけで落ちる一方
  // 減っても気づけないので、「届く経路がすべて閉じているか」を見る。
  test('読み出しはどの経路も名前空間の条件つきで、好み記憶に閉じている', () => {
    const statements = statementsAllowing('bedrock-agentcore:RetrieveMemoryRecords');
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      const conditions = Object.entries(statement.Condition?.StringLike ?? {});
      expect(conditions.length).toBeGreaterThan(0);
      for (const [key, value] of conditions) {
        expect(key).toMatch(/^bedrock-agentcore:namespace/);
        expect(value).toEqual(['sommelier/preference/*']);
      }
      expect(statement.Resource).toEqual(PREFERENCE_MEMORY_ARN);
    }
  });

  test('書き込みは条件なしだが、どの経路も好み記憶に閉じている', () => {
    const statements = statementsAllowing('bedrock-agentcore:CreateEvent');
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement.Resource).toEqual(PREFERENCE_MEMORY_ARN);
    }
  });

  // 上の2つは「その action に届く経路がすべて好み記憶に閉じている」を見ている。
  // ワイルドカードは展開して数えているので * や ? 経由の経路も対象に入るが、
  // 数え上げの網から外れる形（NotAction、組み込み関数）を疑わずに済むよう、
  // そもそもワイルドカードを書かせない側でも止めておく。
  test('action をワイルドカードで与えない', () => {
    const wildcards = allPolicyStatements().filter(
      statement =>
        statement.Effect === 'Allow' &&
        actionsOf(statement).some(action => action.includes('*') || action.includes('?'))
    );
    expect(wildcards).toEqual([]);
  });

  // 数え上げはテンプレートに書かれたポリシーしか見られない。
  // AWS 管理ポリシーを貼られると中身がテンプレートに現れず、
  // 権限を並べ切ったつもりのまま取りこぼす
  test('ロールに管理ポリシーを貼らない', () => {
    const roles = synthesizeProject().findResources('AWS::IAM::Role');
    const attached = Object.values(roles).flatMap((role: any) => role.Properties?.ManagedPolicyArns ?? []);
    expect(attached).toEqual([]);
  });
});
