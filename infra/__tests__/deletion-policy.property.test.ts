// Feature: cdk-backend-auth, Property 4: 利用者データの保護

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { Template } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack.js';
import { ApiStack } from '../lib/api-stack.js';

/**
 * **Validates: Requirements 4.5**
 *
 * Property 4: 利用者データの保護
 *
 * 記録テーブルには dev 環境にも実データが入るため、環境名によらず
 * スタック削除時に残し、誤削除を拒否し、任意時点への復元手段を持つこと。
 *
 * CloudFormation では:
 * - cdk.RemovalPolicy.RETAIN → DeletionPolicy: 'Retain'
 * - deletionProtection: true → DeletionProtectionEnabled: true
 * - pointInTimeRecoveryEnabled: true → PointInTimeRecoverySpecification
 */
describe('Property 4: 利用者データの保護', () => {
  const envNameArb = fc.constantFrom('dev', 'staging', 'prod');

  it('DynamoDB テーブルが環境名によらず保護設定を持つ', () => {
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

        // DynamoDB テーブルリソースをすべて検査
        const dynamoTables = Object.entries(resources).filter(
          ([_, resource]: [string, any]) =>
            resource.Type === 'AWS::DynamoDB::Table',
        );

        // テーブルが2つ存在すること（PurchaseRecord, DrinkingRecord）
        expect(dynamoTables.length).toBe(2);

        for (const [logicalId, resource] of dynamoTables) {
          const table = resource as any;

          expect(
            table.DeletionPolicy,
            `${logicalId} の DeletionPolicy が Retain であること（envName=${envName}）`,
          ).toBe('Retain');

          expect(
            table.UpdateReplacePolicy,
            `${logicalId} の UpdateReplacePolicy が Retain であること（envName=${envName}）`,
          ).toBe('Retain');

          expect(
            table.Properties?.DeletionProtectionEnabled,
            `${logicalId} の削除保護が有効であること（envName=${envName}）`,
          ).toBe(true);

          expect(
            table.Properties?.PointInTimeRecoverySpecification
              ?.PointInTimeRecoveryEnabled,
            `${logicalId} の PITR が有効であること（envName=${envName}）`,
          ).toBe(true);
        }
      }),
      // 環境名は3種類しかなく1回の試行が CDK synth を伴うため試行数を絞る
      { numRuns: 3 },
    );
  }, 60_000);

  it('画像バケットが保持設定とバージョニングを持つ', () => {
    const app = new cdk.App();
    const authStack = new AuthStack(app, 'TestAuthBucket', { envName: 'dev' });
    const apiStack = new ApiStack(app, 'TestApiBucket', {
      envName: 'dev',
      userPool: authStack.userPool,
    });
    const resources = Template.fromStack(apiStack).toJSON().Resources;

    const buckets = Object.entries(resources).filter(
      ([_, resource]: [string, any]) => resource.Type === 'AWS::S3::Bucket',
    );
    expect(buckets.length).toBe(1);

    const [, bucket] = buckets[0] as [string, any];
    expect(bucket.DeletionPolicy).toBe('Retain');
    expect(bucket.Properties?.VersioningConfiguration?.Status).toBe('Enabled');
  });
});
