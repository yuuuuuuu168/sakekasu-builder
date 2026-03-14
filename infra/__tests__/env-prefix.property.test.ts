// Feature: cdk-backend-auth, Property 1: 環境名がリソース名プレフィックスに反映される

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { Template } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack.js';
import { ApiStack } from '../lib/api-stack.js';

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

  it('UserPool 名に環境名プレフィックスが含まれる', () => {
    fc.assert(
      fc.property(envNameArb, (envName) => {
        const app = new cdk.App();
        const authStack = new AuthStack(app, `TestAuth-${envName}`, {
          envName,
        });
        const template = Template.fromStack(authStack);

        template.hasResourceProperties('AWS::Cognito::UserPool', {
          UserPoolName: `${envName}-sakekasu-userpool`,
        });
      }),
      { numRuns: 100 },
    );
  });

  it('UserPoolClient 名に環境名プレフィックスが含まれる', () => {
    fc.assert(
      fc.property(envNameArb, (envName) => {
        const app = new cdk.App();
        const authStack = new AuthStack(app, `TestAuth-${envName}`, {
          envName,
        });
        const template = Template.fromStack(authStack);

        template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
          ClientName: `${envName}-sakekasu-client`,
        });
      }),
      { numRuns: 100 },
    );
  });

  it('DynamoDB テーブル名に環境名プレフィックスが含まれる', () => {
    fc.assert(
      fc.property(envNameArb, (envName) => {
        const app = new cdk.App();
        const authStack = new AuthStack(app, `TestAuth-${envName}`, {
          envName,
        });
        const apiStack = new ApiStack(app, `TestApi-${envName}`, {
          envName,
          userPool: authStack.userPool,
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
      { numRuns: 100 },
    );
  });
});
