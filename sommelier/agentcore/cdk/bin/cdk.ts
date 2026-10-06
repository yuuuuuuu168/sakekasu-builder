#!/usr/bin/env node
import { AgentCoreStack } from '../lib/cdk-stack';
import { ConfigIO, type AwsDeploymentTarget } from '@aws/agentcore-cdk';
import { App, type Environment, Tags } from 'aws-cdk-lib';
import * as path from 'path';
import * as fs from 'fs';

/**
 * aws-targets.json の account に置くダミー。公開リポジトリなので本物の ID を書かず、
 * デプロイ時は CDK CLI が認証情報から入れる CDK_DEFAULT_ACCOUNT を使う
 * （agentcore の設定の読み込みは 12 桁の数字しか受け付けないため、空にはできない）
 */
const PLACEHOLDER_ACCOUNT = '000000000000';

function toEnvironment(target: AwsDeploymentTarget): Environment {
  return {
    account: target.account === PLACEHOLDER_ACCOUNT ? process.env.CDK_DEFAULT_ACCOUNT : target.account,
    region: target.region,
  };
}

function sanitize(name: string): string {
  return name.replace(/_/g, '-');
}

function toStackName(projectName: string, targetName: string): string {
  return `AgentCore-${sanitize(projectName)}-${sanitize(targetName)}`;
}

async function main() {
  // Config root is parent of cdk/ directory. The CLI sets process.cwd() to agentcore/cdk/.
  const configRoot = path.resolve(process.cwd(), '..');
  const configIO = new ConfigIO({ baseDir: configRoot });

  const spec = await configIO.readProjectSpec();
  const targets = await configIO.readAWSDeploymentTargets();

  // Extract MCP configuration from project spec.
  // Gateway fields are stored in agentcore.json but may not yet be on the
  // AgentCoreProjectSpec type from @aws/agentcore-cdk, so we read them
  // dynamically and cast the resulting object.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const specAny = spec as any;
  const mcpSpec = specAny.agentCoreGateways?.length
    ? {
        agentCoreGateways: specAny.agentCoreGateways,
        mcpRuntimeTools: specAny.mcpRuntimeTools,
        unassignedTargets: specAny.unassignedTargets,
      }
    : undefined;

  // Read deployed state for credential ARNs (populated by pre-deploy identity setup)
  let deployedState: Record<string, unknown> | undefined;
  try {
    deployedState = JSON.parse(fs.readFileSync(path.join(configRoot, '.cli', 'deployed-state.json'), 'utf8'));
  } catch {
    // Deployed state may not exist on first deploy
  }

  if (targets.length === 0) {
    throw new Error('No deployment targets configured. Please define targets in agentcore/aws-targets.json');
  }

  const app = new App();
  // 全リソースに App タグ（infra/bin/app.ts と同じ。コストの内訳に使う。デプロイ用ロールの
  // ガードレールの判定にも使う予定だが、ガードレールはまだ無い）
  Tags.of(app).add('App', 'builder');

  for (const target of targets) {
    const env = toEnvironment(target);
    const stackName = toStackName(spec.name, target.name);

    // Extract credentials from deployed state for this target
    const targetState = (deployedState as Record<string, unknown>)?.targets as
      Record<string, Record<string, unknown>> | undefined;
    const targetResources = targetState?.[target.name]?.resources as Record<string, unknown> | undefined;
    const credentials = targetResources?.credentials as
      Record<string, { credentialProviderArn: string; clientSecretArn?: string }> | undefined;

    new AgentCoreStack(app, stackName, {
      spec,
      mcpSpec,
      credentials,
      env,
      description: `AgentCore stack for ${spec.name} deployed to ${target.name} (${target.region})`,
      tags: {
        'agentcore:project-name': spec.name,
        'agentcore:target-name': target.name,
      },
    });
  }

  app.synth();
}

main().catch((error: unknown) => {
  console.error('AgentCore CDK synthesis failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
