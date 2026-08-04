import { describe, it, expect } from 'vitest';
import {
  SommelierError,
  isAbortError,
  messageForError,
  toSommelierError,
} from '../lib/errors';

describe('失敗の種類ごとの文言', () => {
  it('認証切れは再サインインを促す', () => {
    const message = messageForError(new SommelierError('auth', '内部メッセージ'));
    expect(message).toContain('サインイン');
  });

  it('通信断は接続の確認を促す', () => {
    const message = messageForError(new SommelierError('network', '内部メッセージ'));
    expect(message).toContain('通信に失敗');
  });

  it('Runtime 側の異常はステータスを添えて出す', () => {
    const message = messageForError(
      new SommelierError('server', '内部メッセージ', { status: 503 }),
    );
    expect(message).toContain('HTTP 503');
  });

  it('ステータス不明の server ではカッコを出さない', () => {
    const message = messageForError(new SommelierError('server', '内部メッセージ'));
    expect(message).not.toContain('HTTP');
    expect(message).not.toContain('（）');
  });

  it('想定外の失敗は従来どおりの文言にする', () => {
    expect(messageForError(new Error('なにか'))).toContain('応答の取得に失敗');
  });

  it('内部の例外メッセージは画面に出さない', () => {
    const secret = 'arn:aws:bedrock-agentcore:ap-northeast-1:123456789012:runtime/x';
    for (const kind of ['auth', 'network', 'server', 'unknown'] as const) {
      expect(messageForError(new SommelierError(kind, secret))).not.toContain(secret);
    }
  });
});

describe('失敗の種類の判別', () => {
  it('fetch の TypeError は通信断として扱う', () => {
    const converted = toSommelierError(new TypeError('Failed to fetch'));
    expect(converted.kind).toBe('network');
  });

  it('SommelierError はそのまま通す', () => {
    const original = new SommelierError('auth', 'もとの');
    expect(toSommelierError(original)).toBe(original);
  });

  it('元の例外を cause に残す（ログで追えるようにする）', () => {
    const original = new TypeError('Failed to fetch');
    expect(toSommelierError(original).cause).toBe(original);
  });

  it('中断は AbortError として見分けられる', () => {
    expect(isAbortError(new DOMException('中断', 'AbortError'))).toBe(true);
    expect(isAbortError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isAbortError(new SommelierError('network', 'x'))).toBe(false);
  });
});
