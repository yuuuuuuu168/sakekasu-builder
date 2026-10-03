import { parseSharedAuth, sharedAuthIssuer, sharedAuthRegion } from '../lib/shared-auth.js';

const VALID = {
  domain: 'auth.example.com',
  userPoolId: 'ap-northeast-1_AbC123',
  clientId: 'abc123def',
};

describe('parseSharedAuth', () => {
  it('正しい形ならそのまま返す', () => {
    expect(parseSharedAuth(VALID)).toEqual(VALID);
  });

  // 共通ログインは必須。無いまま合成すると AppSync の認可が組めない
  it.each([undefined, null, ''])('値が無ければ落とす（%s）', (value) => {
    expect(() => parseSharedAuth(value)).toThrow(/sharedAuth/);
  });

  it.each([
    ['domain に https:// が付いている', { ...VALID, domain: 'https://auth.example.com' }],
    ['userPoolId にリージョンが無い', { ...VALID, userPoolId: 'AbC123' }],
    ['clientId に記号が混じる', { ...VALID, clientId: 'abc/123' }],
    ['clientId が無い', { domain: VALID.domain, userPoolId: VALID.userPoolId }],
  ])('形が崩れていたら落とす: %s', (_label, value) => {
    expect(() => parseSharedAuth(value)).toThrow(/sharedAuth/);
  });

  it('リージョンと発行者をユーザープール ID から組み立てる', () => {
    expect(sharedAuthRegion(VALID)).toBe('ap-northeast-1');
    expect(sharedAuthIssuer(VALID)).toBe(
      'https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_AbC123',
    );
  });

  // 実際の cdk.json の値が検査を通ること。通らなければ合成（＝デプロイ）が止まる
  it('cdk.json の sharedAuth が検査を通る', async () => {
    const { readFileSync } = await import('node:fs');
    const cdkJson = JSON.parse(
      readFileSync(new URL('../cdk.json', import.meta.url), 'utf8'),
    ) as { context: Record<string, unknown> };
    expect(() => parseSharedAuth(cdkJson.context.sharedAuth)).not.toThrow();
  });
});
