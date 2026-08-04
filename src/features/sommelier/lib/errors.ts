/**
 * ソムリエ呼び出しの失敗を種類ごとに分けて扱う。
 *
 * 以前はどんな失敗でも同じ文言を出していたため、画面からもログからも
 * 原因（認証切れ / 通信断 / Runtime 側の異常）を切り分けられなかった。
 */
export type SommelierErrorKind =
  /** 認証トークンを取れない、または Runtime に拒否された */
  | 'auth'
  /** リクエストが相手に届かなかった、または途中で切れた */
  | 'network'
  /** Runtime までは届いたが正常に応答しなかった */
  | 'server'
  /** 上記に当てはまらない想定外 */
  | 'unknown';

export class SommelierError extends Error {
  readonly kind: SommelierErrorKind;
  /** server の場合の HTTP ステータス */
  readonly status?: number;

  constructor(
    kind: SommelierErrorKind,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'SommelierError';
    this.kind = kind;
    this.status = options.status;
  }
}

/** 中断は失敗ではないため、エラー表示せずに扱う */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * fetch は通信に失敗すると TypeError を投げる。
 * CORS 拒否や DNS 失敗もここに含まれ、内訳はブラウザ側から判別できない。
 */
export function toSommelierError(err: unknown): SommelierError {
  if (err instanceof SommelierError) return err;
  if (err instanceof TypeError) {
    return new SommelierError('network', 'ソムリエに接続できませんでした', { cause: err });
  }
  return new SommelierError('unknown', 'ソムリエの呼び出しに失敗しました', { cause: err });
}

/**
 * 画面に出す文言。次に取るべき行動が分かる粒度にとどめ、
 * 内部の詳細（例外メッセージなど）は出さない
 */
export function messageForError(err: unknown): string {
  const kind = err instanceof SommelierError ? err.kind : 'unknown';

  switch (kind) {
    case 'auth':
      return 'サインインの有効期限が切れたかもしれません。画面を再読み込みするか、サインインし直してください。';
    case 'network':
      return '通信に失敗しました。接続を確認して、もう一度お試しください。';
    case 'server': {
      const status = (err as SommelierError).status;
      const suffix = status ? `（HTTP ${status}）` : '';
      return `ソムリエが応答できませんでした${suffix}。時間をおいてもう一度お試しください。`;
    }
    default:
      return '応答の取得に失敗しました。時間をおいてもう一度お試しください。';
  }
}
