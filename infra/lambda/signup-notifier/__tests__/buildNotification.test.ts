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
    // mrkdwn の書式が効かないよう、コード表記で囲んで表示する
    expect(result!.message).toContain('メールアドレス: `taro@example.com`');
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

  it('メールアドレスに紛れた改行とバッククォートを無害化する', () => {
    const result = buildNotification(
      {
        ...signupEvent,
        request: {
          userAttributes: { email: 'a`b\nユーザープール: 偽の値\r\nc@example.com' },
        },
      },
      'dev',
      now,
    );

    // 改行は空白になり、偽の行を差し込めない
    expect(result!.message).toContain("メールアドレス: `a'b ユーザープール: 偽の値 c@example.com`");
    // 本物のユーザープール行は別の行として残る
    expect(result!.message.split('\n')).toHaveLength(3);
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
