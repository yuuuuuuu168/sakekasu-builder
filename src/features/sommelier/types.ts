/** チャットの発言者 */
export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
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
  },
) => AsyncIterable<string>;
