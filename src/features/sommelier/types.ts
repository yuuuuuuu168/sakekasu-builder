/** チャットの発言者 */
export type ChatRole = 'user' | 'assistant';

/** ソムリエに送れる画像形式（エージェント側の許可リストと揃える） */
export type ChatImageFormat = 'jpeg' | 'png';

/** ペイロードに載せる添付画像。data は base64（data: プレフィックスなし） */
export interface ChatImagePayload {
  format: ChatImageFormat;
  data: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /**
   * 添付画像のプレビュー用 dataURL。
   * サイズが大きいため localStorage には保存しない（枚数だけ imageCount に残す）
   */
  images?: string[];
  /** 添付されていた画像の枚数。保存済み履歴の復元時にプレビューの代わりに表示する */
  imageCount?: number;
  /** 応答をストリーミング受信中かどうか（カーソル表示などに使う） */
  isStreaming?: boolean;
  /** 送信・応答に失敗した場合のメッセージ */
  error?: string;
}

/**
 * ソムリエへの問い合わせ。応答は逐次届くため非同期イテレータで返す。
 *
 * UI はこの型にだけ依存させ、実際の呼び出し方法（ローカルのスタブか
 * AgentCore Runtime か）を差し替えられるようにする。
 */
export type SendToSommelier = (
  prompt: string,
  options: {
    signal: AbortSignal;
    /** 直前までの会話。文脈を引き継ぐために送る（今回の発言は含まない） */
    history: ChatMessage[];
    /**
     * 今回の相談に添付する画像（棚や冷蔵庫の写真など）。
     * 過去の発言の画像は送らない（送信量とコストを抑えるため）
     */
    images?: ChatImagePayload[];
  },
) => AsyncIterable<string>;
