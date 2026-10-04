import { beforeAll, describe, expect, it } from 'vitest';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { SiteStack, siteBucketName } from '../lib/site-stack.js';
import { SiteDnsStack } from '../lib/site-dns-stack.js';

const ACCOUNT = '111111111111';
const DOMAIN = 'sake.sakekasu-builder.com';
const GRAPHQL_URL = 'https://abc.appsync-api.ap-northeast-1.amazonaws.com/graphql';
const IMAGE_BUCKET = 'dev-sakekasu-images.s3.ap-northeast-1.amazonaws.com';

function synthSite(): Template {
  const stack = new SiteStack(new cdk.App(), 'TestSite', {
    envName: 'dev',
    domainName: DOMAIN,
    hostedZoneId: 'Z0000000000000000000',
    zoneName: DOMAIN,
    graphqlUrl: GRAPHQL_URL,
    imageBucketDomain: IMAGE_BUCKET,
    cognitoRegion: 'ap-northeast-1',
    authDomain: 'auth.sakekasu-builder.com',
    sommelierRegion: 'ap-northeast-1',
    env: { account: ACCOUNT, region: 'us-east-1' },
  });
  return Template.fromStack(stack);
}

/** CSP をディレクティブごとに分ける */
function cspOf(template: Template): Map<string, string[]> {
  const policies = Object.values(template.findResources('AWS::CloudFront::ResponseHeadersPolicy'));
  expect(policies).toHaveLength(1);
  const csp = (
    policies[0] as {
      Properties: {
        ResponseHeadersPolicyConfig: {
          SecurityHeadersConfig: { ContentSecurityPolicy: { ContentSecurityPolicy: string } };
        };
      };
    }
  ).Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy
    .ContentSecurityPolicy;
  return new Map(
    csp.split(';').map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values] as const;
    }),
  );
}

describe('SiteStack', () => {
  let template: Template;

  beforeAll(() => {
    template = synthSite();
  });

  it('バケットは公開せず、TLS 以外を拒否し、消さない', () => {
    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      Properties: {
        BucketName: siteBucketName('dev', ACCOUNT),
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      },
    });
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    });
  });

  it('バケット名は配信用ロールと deploy-site.yml が組み立てる形と一致する', () => {
    // github-oidc-stack.ts の `*-sakekasu-site-<account>` と deploy-site.yml の
    // SITE_BUCKET がこの形を前提にしている
    expect(siteBucketName('dev', ACCOUNT)).toBe(`dev-sakekasu-site-${ACCOUNT}`);
  });

  it('CloudFront は OAC で読み、HTTPS へ寄せ、独自ドメインで配る', () => {
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: [DOMAIN],
        PriceClass: 'PriceClass_200',
        ViewerCertificate: Match.objectLike({ MinimumProtocolVersion: 'TLSv1.2_2021' }),
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
      }),
    });
  });

  it('画面の URL を直打ちしても index.html を返す（Amplify のリライトの置き換え）', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 403, ResponseCode: 200, ResponsePagePath: '/index.html' }),
          Match.objectLike({ ErrorCode: 404, ResponseCode: 200, ResponsePagePath: '/index.html' }),
        ]),
      }),
    });
  });

  it('証明書はドメインのゾーンで DNS 検証し、A と AAAA を張る', () => {
    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: DOMAIN,
      ValidationMethod: 'DNS',
    });
    template.hasResourceProperties('AWS::Route53::RecordSet', { Name: `${DOMAIN}.`, Type: 'A' });
    template.hasResourceProperties('AWS::Route53::RecordSet', { Name: `${DOMAIN}.`, Type: 'AAAA' });
  });

  it('CSP はスクリプトを自分のオリジンに限る（unsafe-inline / unsafe-eval を許さない）', () => {
    const csp = cspOf(template);
    expect(csp.get('script-src')).toEqual(["'self'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    // default-src を引き継がないので、明示しないとフォームの送信先が無制限になる
    expect(csp.get('form-action')).toEqual(["'self'"]);
  });

  it('CSP の通信先は画面が実際に叩く先だけ（https: のような丸ごとの許可をしない）', () => {
    const csp = cspOf(template);
    const connect = csp.get('connect-src') ?? [];
    expect(connect).toEqual(
      expect.arrayContaining([
        "'self'",
        'https://abc.appsync-api.ap-northeast-1.amazonaws.com',
        'https://cognito-idp.ap-northeast-1.amazonaws.com',
        'https://auth.sakekasu-builder.com',
        'https://bedrock-agentcore.ap-northeast-1.amazonaws.com',
        `https://${IMAGE_BUCKET}`,
      ]),
    );
    for (const directive of ['connect-src', 'img-src']) {
      expect(csp.get(directive), directive).not.toContain('https:');
      expect(csp.get(directive), directive).not.toContain('*');
    }
    expect(csp.get('img-src')).toContain(`https://${IMAGE_BUCKET}`);
  });

  it('Amplify にあったセキュリティヘッダを引き継ぐ', () => {
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          StrictTransportSecurity: Match.objectLike({
            AccessControlMaxAgeSec: 31536000,
            IncludeSubdomains: true,
          }),
          ContentTypeOptions: Match.anyValue(),
          FrameOptions: Match.objectLike({ FrameOption: 'DENY' }),
          ReferrerPolicy: Match.objectLike({ ReferrerPolicy: 'strict-origin-when-cross-origin' }),
          XSSProtection: Match.objectLike({ Protection: true, ModeBlock: true }),
        }),
        CustomHeadersConfig: {
          Items: [
            Match.objectLike({
              Header: 'Permissions-Policy',
              Value: 'camera=(), microphone=(), geolocation=()',
            }),
          ],
        },
      }),
    });
  });

  it('BucketDeployment などのカスタムリソースを持たない（cdkd から CloudFormation へ戻せなくなる）', () => {
    const types = Object.values(template.toJSON().Resources as Record<string, { Type: string }>).map(
      (r) => r.Type,
    );
    expect(types.filter((t) => t.startsWith('Custom::'))).toEqual([]);
    expect(types).not.toContain('AWS::Lambda::Function');
  });
});

describe('SiteDnsStack', () => {
  it('ゾーンは消さない（作り直すと NS が変わり、親側の委任を入れ直すことになる）', () => {
    const template = Template.fromStack(
      new SiteDnsStack(new cdk.App(), 'TestSiteDns', {
        zoneName: DOMAIN,
        env: { account: ACCOUNT, region: 'ap-northeast-1' },
      }),
    );
    template.hasResource('AWS::Route53::HostedZone', {
      DeletionPolicy: 'Retain',
      Properties: { Name: `${DOMAIN}.` },
    });
  });
});
