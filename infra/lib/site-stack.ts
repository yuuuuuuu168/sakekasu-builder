import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { applyRoleBoundary } from './role-boundary.js';

export interface SiteStackProps extends cdk.StackProps {
  envName: string;
  /** 配信するドメイン。例: sake.sakekasu-builder.com */
  domainName: string;
  /** site-dns-stack.ts が作ったゾーン。スタックの参照ではなく cdk.json の context で渡す */
  hostedZoneId: string;
  zoneName: string;
  /**
   * us-east-1 の証明書の ARN。コンソールで作って cdk.json の context で渡す（cdkd では作らない）。
   * 理由はこのクラスの説明にある
   */
  certificateArn: string;
  /**
   * 画面が叩く AppSync の URL。amplify_outputs.json（画面が実際に読む設定）から渡す。
   * CSP の connect-src に入れる
   */
  graphqlUrl: string;
  /** 画像バケットのドメイン（署名付き URL の PUT と GET）。img-src と connect-src に入れる */
  imageBucketDomain: string;
  /** 共通ログインのユーザープールのリージョン。cognito-idp を connect-src に入れる */
  cognitoRegion: string;
  /**
   * 共通ログインのマネージドログインのドメイン（https:// を付けない）。
   * 認可コードを /oauth2/token でトークンに換えるので connect-src に入れる
   */
  authDomain: string;
  /** ソムリエ（AgentCore Runtime）のリージョン。bedrock-agentcore を connect-src に入れる */
  sommelierRegion: string;
}

/** 配信物を置くバケットの名前。deploy-site.yml と github-oidc-stack.ts も同じ形で組み立てる */
export function siteBucketName(envName: string, account: string): string {
  return `${envName}-sakekasu-site-${account}`;
}

/**
 * フロントの配信（docs/sake-subdomain.md）。S3 に置いて CloudFront から OAC で読む。
 *
 * 以前は Amplify Hosting がコンソールの設定だけで配っていて、ビルド設定・
 * リライト・セキュリティヘッダ・ドメインがすべて IaC の外にあった
 * （docs/amplify-exit.md）。サブドメイン（sake.）へ移るのに合わせて CDK に載せる。
 *
 * CloudFront の証明書は us-east-1 にしか置けないので、このスタックごと us-east-1 に置く。
 *
 * 証明書そのものは cdkd では作らない。コンソールで作り、ARN を context（siteCertificateArn）で
 * 渡す。cdkd は ACM の API を直に叩くが、CDK の `CertificateValidation.fromDns` が付ける
 * 検証設定（DomainValidationOptions の HostedZoneId）を ACM に渡せず、ValidationDomain が
 * null だとして弾かれる（2026-10-04 のデプロイで実際に落ちた）。CloudFormation なら
 * 検証レコードまで書いてくれるが、cdkd はそこも持っていない。共通基盤の auth の証明書と
 * 同じ扱い（sakekasu-integrated_environment の infra/bin/app.ts）。証明書は一度作れば
 * ACM が自動で更新する。
 *
 * 配信物は GitHub Actions（deploy-site.yml）から `aws s3 sync` で置く。CDK の
 * BucketDeployment は使わない。Lambda 製のカスタムリソースが増え、CloudFormation へ
 * 戻す退路（cdkd export）を塞ぐため（docs/amplify-exit.md の「移行するとしたら」）。
 *
 * キャッシュの無効化（CreateInvalidation）は打たない。index.html は
 * `Cache-Control: no-cache` で置き、CACHING_OPTIMIZED の最小 TTL（1 秒）しか
 * 残らないようにしてある。assets/ はファイル名にハッシュが入るので、新しい版は
 * 別の名前で置かれる。こうしておけば配信用のロールに CloudFront の権限が要らない。
 */
export class SiteStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: SiteStackProps) {
    super(scope, id, props);

    // このスタックはロールを作らないが、将来増えたときに境界の付け忘れが起きないように
    // 他のスタックと同じく適用しておく
    applyRoleBoundary(this);

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.zoneName,
    });

    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'Certificate',
      props.certificateArn,
    );

    this.bucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName: siteBucketName(props.envName, this.account),
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      // 中身はビルドし直せば戻るが、バケット名を固定しているので、消えると
      // 同じ名前で作り直すまで配信が止まる。他のバケットと同じく残す
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const graphqlOrigin = new URL(props.graphqlUrl).origin;

    /**
     * セキュリティヘッダ。Amplify のコンソールにあった 7 種（docs/amplify-exit.md の
     * 「セキュリティヘッダ」）を引き継いだうえで、CSP を締めた。
     *
     * - script-src から 'unsafe-inline' と 'unsafe-eval' を外した。Vite の出力に
     *   インラインのスクリプトも eval / new Function も無い（ビルドして確かめた）
     * - connect-src / img-src の `https:`（どこへでも）を、実際に通信する先だけにした
     * - style-src の 'unsafe-inline' は残す。React が style 属性を直接付ける箇所がある
     *
     * 宛先を足したら、ここにも足す。CSP で止められても画面は普通に出るので、
     * 抜けると気づきにくい（ブラウザの開発者ツールのコンソールにだけ出る）
     */
    const imageOrigin = `https://${props.imageBucketDomain}`;
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      // blob: は画像を上げる前のプレビューと圧縮（URL.createObjectURL）
      `img-src 'self' data: blob: ${imageOrigin}`,
      [
        "connect-src 'self'",
        graphqlOrigin,
        // トークンの取り直しとサインアウト時の失効（Amplify が直接呼ぶ）
        `https://cognito-idp.${props.cognitoRegion}.amazonaws.com`,
        `https://${props.authDomain}`,
        `https://bedrock-agentcore.${props.sommelierRegion}.amazonaws.com`,
        imageOrigin,
      ].join(' '),
      "frame-ancestors 'none'",
      "base-uri 'self'",
      // form-action は default-src を引き継がない。書かないと、HTML を差し込まれたときに
      // フォームの送信先を外へ向けられる。画面のフォームはどれも onSubmit で処理していて、
      // ログインもリダイレクトなので、自分のオリジンだけでよい（PR #256 のレビュー指摘）
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ');

    const responseHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      responseHeadersPolicyName: `${props.envName}-sakekasu-site-headers`,
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        xssProtection: { protection: true, modeBlock: true, override: true },
        contentSecurityPolicy: { contentSecurityPolicy: csp, override: true },
      },
      customHeadersBehavior: {
        customHeaders: [
          {
            header: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
            override: true,
          },
        ],
      },
    });

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `sakekasu-builder ${props.envName}`,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: responseHeaders,
        compress: true,
      },
      defaultRootObject: 'index.html',
      domainNames: [props.domainName],
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      // 利用者は日本だけ。北米・欧州・アジア（日本を含む）のエッジに絞る
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      // Amplify のリライト（`/<*>` を /index.html へ、404-200）の置き換え。
      // 画面の URL を直打ちしたときに S3 は 403（キーが無い）を返すので、両方を拾う。
      // TTL を短くしているのは、デプロイ直後に古い index.html を返し続けないため
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
        ttl: cdk.Duration.seconds(10),
      })),
    });

    const target = route53.RecordTarget.fromAlias(
      new route53targets.CloudFrontTarget(this.distribution),
    );
    new route53.ARecord(this, 'AliasA', { zone, recordName: props.domainName, target });
    new route53.AaaaRecord(this, 'AliasAAAA', { zone, recordName: props.domainName, target });

    new cdk.CfnOutput(this, 'SiteBucketName', { value: this.bucket.bucketName });
    new cdk.CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId });
    new cdk.CfnOutput(this, 'SiteUrl', { value: `https://${props.domainName}` });
  }
}
