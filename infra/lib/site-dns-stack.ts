import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import type { Construct } from 'constructs';

export interface SiteDnsStackProps extends cdk.StackProps {
  /** このアカウントで持つゾーンの名前。例: sake.sakekasu-builder.com */
  zoneName: string;
}

/**
 * フロントの配信に使うサブドメインのゾーン（docs/sake-subdomain.md）。
 *
 * 親の sakekasu-builder.com のゾーンは Organization の管理アカウントにあり、
 * このアカウントの cdkd はそこにレコードを書けない。サブドメインのゾーンを
 * このアカウントに置いて親から NS で委任してもらえば、証明書の DNS 検証も
 * エイリアスレコードもこのアカウントで完結する。kakeibo・learning・reinvent と
 * 同じ形。
 *
 * 配信スタック（site-stack.ts）と分けてあるのは、順番を守らないと詰まるため。
 *
 *   1. このスタックを作る（NS 4 つが決まる）
 *   2. 親のゾーンに、そのサブドメインの NS レコードを入れる（管理アカウントでの手作業）
 *   3. dig NS で委任が効いたことを確かめる
 *   4. cdk.json に siteHostedZoneId を書く（ここで初めて配信スタックが合成される）
 *
 * 3 を飛ばして 4 に進むと、証明書の DNS 検証が通らずデプロイが終わらない。
 * 検証レコードは書き込まれるが、誰も引かないゾーンに入るため ACM は
 * PENDING_VALIDATION のまま待ち続ける（kakeibo で実際に 45 分止めた）。
 *
 * ゾーンは消えない設定にしてある。作り直すと NS が変わり、親側の委任も
 * 入れ直しになる。
 */
export class SiteDnsStack extends cdk.Stack {
  public readonly zone: route53.PublicHostedZone;

  constructor(scope: Construct, id: string, props: SiteDnsStackProps) {
    super(scope, id, props);

    this.zone = new route53.PublicHostedZone(this, 'Zone', {
      zoneName: props.zoneName,
      comment: 'sakekasu-builder frontend (delegated from the parent zone)',
    });
    this.zone.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    new cdk.CfnOutput(this, 'HostedZoneId', {
      value: this.zone.hostedZoneId,
      description: 'cdk.json の siteHostedZoneId に書く値',
    });

    // 親のゾーンに入れる NS レコードの中身。手で写すのでまとめて出す
    new cdk.CfnOutput(this, 'NameServers', {
      value: cdk.Fn.join(' ', this.zone.hostedZoneNameServers ?? []),
      description: '親のゾーンに NS レコードとして入れる 4 つ',
    });
  }
}
