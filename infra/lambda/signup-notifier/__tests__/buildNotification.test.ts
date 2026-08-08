import { buildNotification } from '../index.js';

const signupEvent = {
  triggerSource: 'PostConfirmation_ConfirmSignUp',
  userPoolId: 'ap-northeast-1_TEST',
  userName: 'abc-123',
  request: {
    userAttributes: { email: 'taro@example.com' },
  },
};

// タイムゾーンに依存しないよう固定時刻（UTC）で検証する
const now = new Date('2026-08-08T03:04:05Z');

describe('buildNotification', () => {
  it('サインアップ確認では件名と本文を組み立てる', () => {
    const result = buildNotification(signupEvent, 'dev', now);

    expect(result).not.toBeNull();
    expect(result!.subject).toBe('🎉 新しいユーザーが登録されました（dev）');
    expect(result!.message).toContain('メールアドレス: taro@example.com');
    expect(result!.message).toContain('ユーザープール: ap-northeast-1_TEST');
    // JST は UTC+9 なので 12:04:05 になる
    expect(result!.message).toContain('12:04:05');
  });

  it('パスワード再設定の確認では通知しない', () => {
    const result = buildNotification(
      { ...signupEvent, triggerSource: 'PostConfirmation_ConfirmForgotPassword' },
      'dev',
      now,
    );

    expect(result).toBeNull();
  });

  it('triggerSource が無いイベントでは通知しない', () => {
    expect(buildNotification({}, 'dev', now)).toBeNull();
  });

  it('メールアドレスが無くても壊れない', () => {
    const result = buildNotification(
      { ...signupEvent, request: { userAttributes: {} } },
      'dev',
      now,
    );

    expect(result!.message).toContain('(メールアドレス不明)');
  });
});
