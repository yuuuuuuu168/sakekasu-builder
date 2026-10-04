// Feature: cdk-backend-auth, Property 1: 環境名がリソース名プレフィックスに反映される

import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { Template } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack.js';
import { TEST_SHARED_AUTH } from './shared-auth-fixture.js';

/**
 * **Validates: Requirements 1.4**
 *
 * Property 1: 環境名がリソース名プレフィックスに反映される
 *
 * 有効な環境名（dev, staging, prod）に対して、CDK スタックを合成した場合、
 * 生成される CloudFormation テンプレート内のリソース名にその環境名が
 * プレフィックスとして含まれること。
 */
describe('Property 1: 環境名がリソース名プレフィックスに反映される', () => {
  const envNameArb = fc.constantFrom('dev', 'staging', 'prod');

  // 環境名は3種類しかないため、20回も引けば全値をほぼ確実に踏む。
  // ApiStack は Lambda を持ち synth ごとに esbuild が走るので、
  // 100回だと既定の5秒に収まらない
  const numRuns = 20;
  const timeout = 120_000;

  it('DynamoDB テーブル名に環境名プレフィックスが含まれる', { timeout }, () => {
    fc.assert(
      fc.property(envNameArb, (envName) => {
        const app = new cdk.App();
        const apiStack = new ApiStack(app, `TestApi-${envName}`, {
          envName,
          sharedAuth: TEST_SHARED_AUTH,
        });
        const template = Template.fromStack(apiStack);

        // PurchaseRecord テーブル
        template.hasResourceProperties('AWS::DynamoDB::Table', {
          TableName: `${envName}-sakekasu-purchase-records`,
        });

        // DrinkingRecord テーブル
        template.hasResourceProperties('AWS::DynamoDB::Table', {
          TableName: `${envName}-sakekasu-drinking-records`,
        });
      }),
      { numRuns },
    );
  });
});
