// Feature: cdk-backend-auth, Property 4: 環境別削除ポリシー

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { Template } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack.js';
import { ApiStack } from '../lib/api-stack.js';

/**
 * **Validates: Requirements 4.5**
 *
 * Property 4: 環境別削除ポリシー
 *
 * 任意の環境名に対して、DynamoDB テーブルの削除ポリシーは
 * 環境名が "prod" の場合 RETAIN、それ以外の場合 DESTROY に設定されること。
 *
 * CloudFormation では:
 * - cdk.RemovalPolicy.RETAIN → DeletionPolicy: 'Retain'
 * - cdk.RemovalPolicy.DESTROY → DeletionPolicy: 'Delete'
 */
describe('Property 4: 環境別削除ポリシー', () => {
  const envNameArb = fc.constantFrom('dev', 'staging', 'prod');

  it('DynamoDB テーブルの DeletionPolicy が環境名に応じて正しく設定される', () => {
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
        const resources = template.toJSON().Resources;

        const expectedPolicy = envName === 'prod' ? 'Retain' : 'Delete';

        // DynamoDB テーブルリソースをすべて検査
        const dynamoTables = Object.entries(resources).filter(
          ([_, resource]: [string, any]) =>
            resource.Type === 'AWS::DynamoDB::Table',
        );

        // テーブルが2つ存在すること（PurchaseRecord, DrinkingRecord）
        expect(dynamoTables.length).toBe(2);

        for (const [logicalId, resource] of dynamoTables) {
          expect(
            (resource as any).DeletionPolicy,
            `${logicalId} の DeletionPolicy が ${expectedPolicy} であること（envName=${envName}）`,
          ).toBe(expectedPolicy);
        }
      }),
      { numRuns: 100 },
    );
  });
});
