import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const snsClient = new SNSClient({});

/** 通知を流す SNS トピック（監視スタックのアラートトピック） */
const TOPIC_ARN = process.env.TOPIC_ARN!;
/** 通知に添える環境名（dev, staging, prod） */
const ENV_NAME = process.env.ENV_NAME ?? '不明';

/**
 * SNS 送信の打ち切り時間。
 * Cognito はこのトリガーの完了を 5 秒しか待たず、超えるとサインアップの
 * 確認そのものがエラーになる。その 5 秒にはコールドスタートも含まれるが、
 * このタイマーが動き出すのはハンドラ開始時（＝コールドスタート後）なので、
 * 初回起動の遅れを見込んで大きめの余裕を残して諦める
 */
const PUBLISH_TIMEOUT_MS = 1500;

/** Cognito Post Confirmation トリガーのイベント（使う項目だけ） */
export interface PostConfirmationEvent {
  /** 確認の種類。サインアップ確認とパスワード再設定確認の両方で呼ばれる */
  triggerSource?: string;
  userPoolId?: string;
  userName?: string;
  request?: {
    userAttributes?: Record<string, string>;
  };
}

/** JST での表示。運用しているのが日本時間のため */
function formatJst(date: Date): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(date);
}

/**
 * 通知の件名と本文を組み立てる。通知しないイベントでは null を返す。
 *
 * Post Confirmation はパスワード再設定の確認でも呼ばれるため、
 * サインアップの確認だけに絞る（再設定は既存の利用者なので通知しない）
 */
export function buildNotification(
  event: PostConfirmationEvent,
  envName: string,
  now: Date,
): { subject: string; message: string } | null {
  if (event.triggerSource !== 'PostConfirmation_ConfirmSignUp') return null;

  const email = event.request?.userAttributes?.email ?? '(メールアドレス不明)';

  return {
    subject: `🎉 新しいユーザーが登録されました（${envName}）`,
    message: [
      `メールアドレス: ${email}`,
      `登録時刻: ${formatJst(now)}（JST）`,
      `ユーザープール: ${event.userPoolId ?? '不明'}`,
    ].join('\n'),
  };
}

/**
 * 通知の失敗でサインアップを巻き添えにしないため、この関数は決して throw しない。
 * 失敗はログに残し、メトリクスフィルター（SignupNotifyFailCount）経由で
 * アラームに拾わせる
 */
export const handler = async (event: PostConfirmationEvent): Promise<PostConfirmationEvent> => {
  try {
    const notification = buildNotification(event, ENV_NAME, new Date());
    if (notification) {
      await snsClient.send(
        new PublishCommand({
          TopicArn: TOPIC_ARN,
          Subject: notification.subject,
          Message: notification.message,
        }),
        { abortSignal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS) },
      );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        action: 'notifySignup',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  // Post Confirmation はイベントをそのまま返す決まり
  return event;
};
